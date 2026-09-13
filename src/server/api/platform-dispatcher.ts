import { createMcpToken, listMcpTokens, revokeMcpToken } from "../mcp-tokens";
import { UNHANDLED, type ApiDispatcher } from "./dispatcher";

export const dispatchPlatform: ApiDispatcher = ({
  root,
  id,
  action,
  method,
  user,
  data,
}) => {
  if (root === "config" && method === "GET")
    return {
      amapJsKey: process.env.AMAP_JS_KEY || "",
      mapAvailable: !!(
        process.env.AMAP_JS_KEY && process.env.AMAP_SECURITY_CODE
      ),
      testMode: process.env.AMAP_TEST_MODE === "1",
    };
  if (root === "mcp-tokens" && !action) {
    if (method === "GET" && !id) return listMcpTokens(user);
    if (method === "POST" && !id) return createMcpToken(user, data);
    if (method === "DELETE" && id) return revokeMcpToken(user, id);
  }
  return UNHANDLED;
};
