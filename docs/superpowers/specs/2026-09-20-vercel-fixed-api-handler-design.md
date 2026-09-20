# Vercel Fixed API Handler Design

The production deployment builds `api/[...path].js` but Vercel returns a platform-level 404 for every `/api/*` URL. Replace the dynamic function entry with a literal `api/handler.js` function and rewrite public API paths to it with the requested path in an internal query parameter.

The handler will resolve either direct local URLs such as `/api/config` or rewritten Vercel URLs such as `/api/handler?__path=config`. Existing route modules remain unchanged. Routing tests will verify the function count, rewrite contract, public path, rewritten path, and unknown-route behavior.
