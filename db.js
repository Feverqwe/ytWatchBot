/**
 * Created by Anton on 19.02.2017.
 */
var debug = require('debug')('app:db');

var Db = function (options) {
    this.config = options.config.db;
    this.connection = null;

    this.onReady = this.init();
};

Db.prototype.init = function () {
    "use strict";
    var _this = this;
    var mysql = require('mysql');

    var db = _this.connection = mysql.createConnection({
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database
    });

    return new Promise(function (resolve, reject) {
        db.connect(function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

module.exports = Db;