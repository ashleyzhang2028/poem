#!/usr/bin/env node

"use strict";

var path = require("path");
var ops = require(path.join(__dirname, "..", "api/_lib/ops.js"));
process.stdout.write(ops.envExample());
