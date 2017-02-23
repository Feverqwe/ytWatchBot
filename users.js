/**
 * Created by Anton on 23.02.2017.
 */
"use strict";
var debug = require('debug')('app:Users');

var Users = function (options) {
    this.gOptions = options;

    this.onReady = this.init();
};

Users.prototype.init = function () {
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `users` ( \
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `uuid` TEXT CHARACTER SET utf8mb4 NOT NULL, \
                `channelId` TEXT CHARACTER SET utf8mb4 NULL, \
                `data` TEXT CHARACTER SET utf8mb4 NOT NULL, \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC),\
            UNIQUE INDEX `channelId_UNIQUE` (`channelId` ASC)); \
        ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `userIdChannelId` ( \
                `userId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `service` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
            UNIQUE INDEX `userIdServiceChannelId_UNIQUE` (`userId` ASC, `service` ASC, `channelId` ASC), \
            FOREIGN KEY (`userId`) \
                    REFERENCES `users` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE); \
        ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    return promise;
};

Users.prototype.getUser = function (id) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM users WHERE id = ? LIMIT 1; \
        ', [id], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0]);
            }
        });
    });
};

Users.prototype.setUser = function (id, uuid, data) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        var item = {
            id: id,
            uuid: uuid,
            data: data
        };
        db.connection.query('\
            INSERT INTO users SET ?; \
        ', item, function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0]);
            }
        });
    });
};

Users.prototype.changeUserId = function (id, newId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE users SET id = ? WHERE id = ?; \
        ', [newId, id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

Users.prototype.changeUserData = function (id, data) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE users SET data = ? WHERE id = ?; \
        ', [data, id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

Users.prototype.removeUser = function (id) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM users WHERE id = ?; \
        ', [id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

Users.prototype.setUserChannel = function (id, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE users SET channelId = ? WHERE id = ?; \
        ', [channelId, id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

Users.prototype.removeUserChannel = function (channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE users SET channelId = ? WHERE channelId = ?; \
        ', [null, channelId], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

Users.prototype.getChannels = function (userId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT service, channelId FROM userIdChannelId WHERE userId = ?; \
        ', [userId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

Users.prototype.insertChannel = function (userId, service, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        var item = {
            userId: userId,
            service: service,
            channelId: channelId
        };
        db.connection.query('\
            INSERT INTO userIdChannelId SET ?; \
        ', item, function (err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
};

Users.prototype.removeChannel = function (userId, service, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM userIdChannelId WHERE userId = ? AND service = ? AND channelId = ?; \
        ', [userId, service, channelId], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

Users.prototype.getAllChannels = function () {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM userIdChannelId; \
        ', function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

Users.prototype.getUsersByChannel = function (service, channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT userId FROM userIdChannelId WHERE service = ? AND channelId = ?; \
        ', [service, channelId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

module.exports = Users;