'use strict';
const { route } = require('../router');
const { render } = require('../template');
const { buildNav } = require('./_helpers');
const { withSiteName } = require('./home');

route('GET', '/help', ({ res, user }) => {
    render(res, 'help.html', withSiteName({
        current_user: user || {},
        nav: buildNav(user),
        is_domain_view: false,
    }));
}, { auth: true });
