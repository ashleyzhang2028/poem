"use strict";

var routes = require("./_lib/routes.js");
var H = require("./_lib/http.js");

module.exports = function (req, res) {
  var hit = routes.resolve(req.method, req.url);
  if (!hit) {

    return H.json(res, 404, { code: "E_404", message: "没有这个接口。" });
  }
  return hit.handler(req, res);
};
