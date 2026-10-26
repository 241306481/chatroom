'use strict';
const { DATA_DIR, USER_DIR, DOMAIN_DIR } = require('./paths');
const { ensureDir } = require('./fs-utils');
function ensureDirs() {
    [DATA_DIR, USER_DIR, DOMAIN_DIR].forEach(ensureDir);
}
module.exports = { ensureDirs };
