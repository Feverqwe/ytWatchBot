/**
 * Created by Anton on 30.04.2017.
 */
"use strict";
const debug = require('debug')('app:channels');

class Channels {
  constructor(/**Main*/main) {
    this.main = main;
  }

  init() {
    /*var _this = this;
    var db = this.main.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            CREATE TABLE IF NOT EXISTS channels ( \
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `service` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `title` TEXT CHARACTER SET utf8mb4 NULL, \
                `url` TEXT CHARACTER SET utf8mb4 NOT NULL, \
                `publishedAfter` TEXT CHARACTER SET utf8mb4 NULL, \
                `subscribeExpire` INT NULL DEFAULT 0, \
            INDEX `service_idx` (`service` ASC),  \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC)); \
        ', function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });*/
  }

  /**
   * @param {string} id
   * @param {string} service
   */
  wrapId(id, service) {
    return [service.substr(0, 2), JSON.stringify(id)].join(':');
  }

  unWrapId(id) {
    var _id = id.substr(3);
    return JSON.parse(_id);
  }

  /**
   * @private
   * @param {string[]} ids
   * @return {Promise.<dbChannel[]>}
   */
  getChannels(ids) {
    this.main.db.models.Channels.findAll({
      where: {id: ids}
    }).then((channels) => {
      return channels.map(channel => channel.get({plain: true}));
    });

    /*var _this = this;
      var db = this.main.db;
      return new Promise(function (resolve, reject) {
          if (!ids.length) {
              return resolve([]);
          }

          db.connection.query('\
              SELECT * FROM channels WHERE id IN ?; \
          ', [[ids]], function (err, results) {
              if (err) {
                  reject(err);
              } else {
                  resolve(results);
              }
          });
      }).catch(function (err) {
          debug('getChannels error', err);
          return [];
      });*/
  }

  /**
   * @param {*} id
   * @param {string} service
   * @param {string} title
   * @param {string} url
   * @return {Promise.<dbChannel>}
   */
  insertChannel(id, service, title, url) {
    // var _this = this;
    const channel = {
      id: this.wrapId(id, service),
      service: service,
      title: title,
      url: url
    };
    return this.main.db.models.Channels.upsert(channel).then(() => {
      return channel;
    });
    /*var db = this.main.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            INSERT INTO channels SET ? ON DUPLICATE KEY UPDATE ? \
        ', [info, info], function (err, results) {
            if (err) {
                debug('insertChannel', err);
                reject(err);
            } else {
                resolve(info);
            }
        });
    });*/
  }

  /**
   * @param {string} id
   * @param {dbChannel} channel
   */
  updateChannel(id, channel) {
    return this.main.db.models.Channels.update(channel, {
      where: {id}
    });
    /*var _this = this;
    var db = this.main.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE channels SET ? WHERE id = ? \
        ', [channel, id], function (err, results) {
            if (err) {
                debug('updateChannel', err);
                reject(err);
            } else {
                resolve();
            }
        });
    }).catch(function (err) {
        debug('updateChannel error', err);
    });*/
  }

  /**
   * @param {string} id
   * @return {Promise}
   */
  removeChannel(id) {
    return this.main.db.models.Channels.destroy({
      where: {id}
    });
    /*var _this = this;
    var db = this.main.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM channels WHERE id = ?; \
        ', [id], function (err) {
            if (err) {
                debug('deleteChannel error', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });*/
  }

  /**
   * @typedef {{}} dbChannel
   * @property {string} id
   * @property {string} service
   * @property {string} title
   * @property {string} url
   * @property {string} publishedAfter
   * @property {number} subscribeExpire
   */
  removeUnusedChannels() {
    const Sequelize = this.main.db.sequelize;
    const Op = Sequelize.Op;
    return this.main.db.models.Channels.destroy({
      where: {
        id: {[Op.notIn]: Sequelize.literal(`(SELECT DISTINCT channelId FROM chatIdChannelId)`)}
      }
    });
    /*var db = this.main.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM channels WHERE id NOT IN (SELECT DISTINCT channelId FROM chatIdChannelId); \
        ', function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    }).catch(function (err) {
        debug('removeUnusedChannels error', err);
    });*/
  }
}

module.exports = Channels;