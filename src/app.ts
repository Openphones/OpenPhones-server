import coinbase from "coinbase-commerce-node";
import CC from "currency-converter-lt";
import express from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Stripe } from "stripe";
import yup from "yup";
import config from "./config.js";
import { ProductInfo, verifyReq } from "./util.js";
import { fileURLToPath } from "url";
import { join } from "path";
import adminRouter from "./adminServer.js";
import { JsonDB, Config } from "node-json-db";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const database = new JsonDB(new Config(join(__dirname, "database.json"), true, true, "/"));
await database.load();

const stripeClient = new Stripe(config.StripePrivateKey, { apiVersion: "2022-11-15" });
coinbase.Client.init(config.CoinbaseKey);

const app = express();
const server = createServer(app);

const shippingCountries: Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] = [
    "AC", "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CV", "CW", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MK", "ML", "MM", "MN", "MO", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SZ", "TA", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW", "ZZ"
]

app.use(express.json());
app.use(rateLimit({ max: 20 }));
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH"
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
            quantity: yup.number().required(),
            overrides: yup.object({
                color: yup.string().required(),
                size: yup.number().required()
            }).required()
        })).required().min(1)
    }).required()
})
app.post("/create-checkout-session", verifyReq(checkoutSchema), async (req, res) => {
    try {
        // get the product info from the database
        const rawProducts = req.body.items as { id: string, quantity: number, overrides: { color: string; size: number; } }[];
        const ourProducts = await getProducts();

        if (req.body.type === "stripe") {
            const products = rawProducts.map(product => {
                const realProduct = ourProducts.find(p => p.id === product.id);
                if (!realProduct) throw new Error("BR: Invalid product id");

                // check if all the overrides are valid
                if (!realProduct.overrides.color.find(c => c.name === product.overrides.color)) throw new Error("BR: Invalid color override");
                if (!realProduct.overrides.storage.find(s => s.size === product.overrides.size)) throw new Error("BR: Invalid storage override");

                return {
                    price_data: {
                        currency: "usd",
                        unit_amount: realProduct.price * 100,
                        product_data: {
                            name: realProduct.short_name,
                            images: realProduct.images,
                            description: `Color: ${realProduct.overrides.color.find(c => c.name === product.overrides.color).readable}, Storage: ${product.overrides.size}GB`,
                            metadata: {
                                "color": product.overrides.color,
                                "storage": product.overrides.size
                            }
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
                    allowed_countries: shippingCountries
                },
                automatic_tax: {
                    enabled: false
                }
            });

            res.json({ url: session.url });
        }
    } catch (e) {
        if (e.message.startsWith("BR: ")) return res.status(400).send({ error: e.message.replace("BR: ", "") });

        console.error(e);
        res.status(500).send({ error: e.message });
    }
});

app.get("/products", async (req, res) => {
    const currency = req.query.currency as string;
    const products = await getProducts();

    if (currency) {
        try {
            const converter = new CC({ from: "USD", to: currency });
            // convert the price without using Array.map
            const productInfoWithCurrency = [];
            for (const product of products) {
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
    return res.json(products);
});

async function getProducts() {
    return await database.getData("/products") as ProductInfo[];
}

app.use(express.static(join(__dirname, "admin")));
app.use("/admin", adminRouter);

server.listen(config.ServerPort, () => { console.log("Server started"); });

export { database };