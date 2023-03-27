import express from "express";
import { Stripe } from "stripe";
import yup from "yup";
import config from "./config.js";
import productInfo from "./productInfo.js";
import { verifyReq } from "./util.js";
import rateLimit from "express-rate-limit";
import CC from "currency-converter-lt";
import { createServer } from "https";
import { readFileSync } from "fs";
import { join } from "path";


const app = express();
const stripeClient = new Stripe(config.StripePrivateKey, { apiVersion: "2022-11-15" });
const server = createServer({
    key: readFileSync(join("cert", "key.pem")),
    cert: readFileSync(join("cert", "cert.pem")),
    passphrase: config.CertPass
}, app);

app.use(express.json());
app.use(rateLimit({ max: 15 }));

app.use((err, req, res, next) => {
    //@ts-ignore
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.sendStatus(400);
    }
    next();
})

const checkoutSchema = yup.object({
    body: yup.array().of(yup.object({
        id: yup.string().required(),
        quantity: yup.number().required()
    })).required().min(1)
})
app.post("/create-checkout-session", verifyReq(checkoutSchema), async (req, res) => {
    try {
        // get the product info from the database
        const rawProducts = req.body as { id: string, quantity: number }[];
        const products = rawProducts.map(product => {
            const realProduct = productInfo.find(p => p.id === product.id);
            if (!realProduct) throw new Error("Invalid product id");
            return {
                price_data: {
                    currency: "usd",
                    unit_amount: realProduct.price,
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
            success_url: `https://${config.DomainName}:${config.ServerPort}/success.html`,
            cancel_url: `https://${config.DomainName}:${config.ServerPort}/cancel.html`,
            shipping_address_collection: {
                allowed_countries: ["US", "HU"]
            },
        });

        res.json({ url: session.url });

    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});

app.get("/products", async (req, res) => {
    const currency = req.query.currency as string;
    if (currency) {
        try {
            const converter = new CC({ from: "USD", to: currency });
            const productInfoWithCurrency = await productInfo.map(async product => {
                return {
                    ...product,
                    price: await converter.convert(product.price)
                }
            })
            return res.json(productInfoWithCurrency);
        } catch (e) {
            return res.status(400).json({ error: "Invalid currency" });
        }
    }
    return res.json(productInfo);
})

server.listen(config.ServerPort, () => { console.log("Server started"); });