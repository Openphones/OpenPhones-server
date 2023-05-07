import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import express, { NextFunction, Request, Response } from "express";
import otplib from "otplib";
import yup from "yup";
import { database } from "./app.js";
import config from "./config.js";
import { ProductInfo, verifyReq } from "./util.js";

let authCode = "";

const router = express.Router();

const loginSchema = yup.object({
    body: yup.object({
        password: yup.string().required(),
        totp: yup.string().matches(/^\d{6}$/).required()
    }).required()
});

function authReq(req: Request, res: Response, next: NextFunction) {
    if (req.headers.authorization !== authCode && authCode !== "") return res.sendStatus(401);
    return next();
}

// password hash and totp secret are defined in config
router.post("/login", verifyReq(loginSchema), (req, res) => {
    // get password
    const password = req.body.password as string;
    // get totp
    const totp = req.body.totp as string;

    try {
        if (!otplib.authenticator.check(totp, config.Admin.TOTP))
            return res.status(401).send("Invalid TOTP");
    } catch (err) {
        return res.status(500).send("Error validating TOTP");
    }

    // calculate hash
    const passwordHash = pbkdf2Sync(password, Buffer.from(config.Admin.salt, "base64"), 1_000_000, 64, "sha512");

    // check if password hash is correct
    if (!timingSafeEqual(passwordHash, Buffer.from(config.Admin.password, "base64"))) return res.sendStatus(401);

    // generate a new auth code
    authCode = randomBytes(128).toString("base64");

    // send auth code
    return res.send(authCode);
});

router.get("/products", authReq, async (req, res) => {
    return res.send(await database.getData("/products"));
});

router.patch("/products", authReq, async (req, res) => {
    const products = req.body as ProductInfo[];
    await database.push("/products", products, true);
    return res.sendStatus(200);
});

export default router;