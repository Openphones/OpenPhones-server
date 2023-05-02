import coinbase from "coinbase-commerce-node";
import CC from "currency-converter-lt";
import express from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Stripe } from "stripe";
import yup from "yup";
import config from "./config.js";
import productInfo from "./productInfo.js";
import { verifyReq } from "./util.js";
const stripeClient = new Stripe(config.StripePrivateKey, { apiVersion: "2022-11-15" });
coinbase.Client.init(config.CoinbaseKey);

const app = express();
const server = createServer(app);

app.use(express.json());
app.use(rateLimit({ max: 15 }));
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST"
    );
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
})

app.use((err, req, res, next) => {
    //@ts-ignore
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.sendStatus(400);
    }
    next();
})

const checkoutSchema = yup.object({
    body: yup.object({
        type: yup.string().required().ensure().oneOf(["stripe"]),
        items: yup.array().of(yup.object({
            id: yup.string().required(),
            quantity: yup.number().required()
        })).required().min(1)
    }).required()
})
app.post("/create-checkout-session", verifyReq(checkoutSchema), async (req, res) => {
    try {
        // get the product info from the database
        const rawProducts = req.body.items as { id: string, quantity: number }[];

        if (req.body.type === "stripe") {
            const products = rawProducts.map(product => {
                const realProduct = productInfo.find(p => p.id === product.id);
                if (!realProduct) throw new Error("Invalid product id");
                return {
                    price_data: {
                        currency: "usd",
                        unit_amount: realProduct.price * 100,
                        product_data: {
                            name: realProduct.short_name,
                            images: realProduct.images,
                        }
                    },
                    quantity: product.quantity
                } satisfies Stripe.Checkout.SessionCreateParams.LineItem
            });

            const session = await stripeClient.checkout.sessions.create({
                payment_method_types: ["card"],
                mode: "payment",
                line_items: products,
                success_url: `https://${config.DomainName}/success/`,
                cancel_url: `https://${config.DomainName}/cancel/`,
                shipping_address_collection: {
                    allowed_countries: ["US"]
                },
                automatic_tax: {
                    enabled: false
                }
            });

            res.json({ url: session.url });
        }

        // this code is totally busted atm, will have to sort it out later
        /*
        if (req.body.type === "coinbase") {
            // calculate total price
            const totalPrice = rawProducts.reduce((acc, product) => {
                const realProduct = productInfo.find(p => p.id === product.id);
                if (!realProduct) throw new Error("Invalid product id");
                return acc + realProduct.price * product.quantity;
            }, 0);

            const itemCount = rawProducts.reduce((acc, product) => acc + product.quantity, 0);
            
            const checkoutObj = new coinbase.resources.Checkout({
                name: `Openphones Order for ${itemCount} item${itemCount === 1 ? "" : "s"}`,
                description: rawProducts.map(product => `${product.quantity}x${product.id}`).join(", "),
                pricing_type: "fixed_price",
                local_price: {
                    amount: totalPrice.toString(),
                    currency: "USD"
                },
                requested_info: ["email", "name"],
            });

            const charge = await checkoutObj.save();

            res.json({ url: charge.hosted_url });
        }*/

    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});

app.get("/products", async (req, res) => {
    const currency = req.query.currency as string;
    if (currency) {
        try {
            const converter = new CC({ from: "USD", to: currency });
            // convert the price without using Array.map
            const productInfoWithCurrency = [];
            for (const product of productInfo) {
                productInfoWithCurrency.push({
                    ...product,
                    price: Number((await converter.convert(product.price) as number).toFixed(2))
                });
            }
            return res.json(productInfoWithCurrency);
        } catch (e) {
            return res.status(400).json({ error: "Invalid currency" });
        }
    }
    return res.json(productInfo);
})

server.listen(config.ServerPort, () => { console.log("Server started"); });