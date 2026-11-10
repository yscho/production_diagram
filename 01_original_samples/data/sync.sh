#!/bin/sh
# line.json -> line.js (window.LINE_DATA). file:// 에서는 fetch가 막히므로 각 샘플은 ../data/line.js 를 <script src>로 읽음.
cd "$(dirname "$0")" && { printf 'window.LINE_DATA = '; cat line.json; printf ';\n'; } > line.js && echo "line.js 갱신 완료"
