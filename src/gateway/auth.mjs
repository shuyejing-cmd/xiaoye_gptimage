import { timingSafeEqual } from "node:crypto";
import { AppError } from "../shared/errors.mjs";
export function requireBearerToken(expected){return (header)=>{const value=header||"";const target=`Bearer ${expected}`;const a=Buffer.from(value),b=Buffer.from(target);if(a.length!==b.length||!timingSafeEqual(a,b))throw new AppError({code:"unauthorized",message:"Unauthorized",httpStatus:401});};}