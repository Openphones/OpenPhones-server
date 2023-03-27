import { NextFunction, Request, Response } from "express";

export interface ProductInfo {
    id: string;
    short_name: string;
    long_name: string;
    price: number;
    images: string[];
    quality: "new" | "used";
    description: string;
}

/**
 * @function
 * @name verifyReq
 * @description Verifies request body, query, and params against a schema
 * @param {Object} schema yup schema to validate against
 * @returns {Function} middleware function for express
 */
export const verifyReq = (schema: any) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        await schema.validate({
            body: req.body,
            query: req.query,
            params: req.params
        });
        return next();
    } catch (err) {
        return res.status(400).json({ type: err.name, message: err.message })
    }
}