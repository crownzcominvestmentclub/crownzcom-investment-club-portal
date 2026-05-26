// Public configuration endpoint (no auth required)

import { Hono } from "hono";
import type { AppContext } from "../middleware";

export const config = new Hono<AppContext>();

config.get("/", (c) => {
  return c.json({
    allowEmailLogin: c.env.EMAIL_PASSWORD_SIGNIN_ENABLED?.toLowerCase() !== "false",
  });
});
