#!/bin/sh
set -eu
cd "$(dirname "$0")"
node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync("factory.json","utf8")); const out="window.FACTORY_DATA="+JSON.stringify(d)+";\nwindow.LINE_DATA={line:window.FACTORY_DATA.line,simulation:window.FACTORY_DATA.simulation,statusColors:window.FACTORY_DATA.statusColors,stages:window.FACTORY_DATA.stages};\n"; fs.writeFileSync("factory.js",out);'
