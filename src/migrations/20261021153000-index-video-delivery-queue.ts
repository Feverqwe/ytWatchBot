import {DataTypes} from 'sequelize';
import type {Migration} from '../shared/migrator';

const table = 'chatIdVideoId';
const indexName = 'chatId_publishedAt_videoId_idx';

export const up: Migration = async ({context}) => {
  // MariaDB DDL commits implicitly. Keep each step safe to resume after a failed startup.
  const columns = await context.describeTable(table);
  if (!columns.publishedAt) {
    await context.addColumn(table, 'publishedAt', {type: DataTypes.DATE, allowNull: true});
  }

  await context.sequelize.query(
    'UPDATE `chatIdVideoId` AS queue ' +
      'INNER JOIN `videos` AS video ON video.id = queue.videoId ' +
      'SET queue.publishedAt = video.publishedAt WHERE queue.publishedAt IS NULL',
  );

  if (!columns.publishedAt || columns.publishedAt.allowNull) {
    await context.changeColumn(table, 'publishedAt', {type: DataTypes.DATE, allowNull: false});
  }

  const indexes = (await context.showIndex(table)) as Array<{name: string}>;
  if (!indexes.some(({name}) => name === indexName)) {
    await context.addIndex(table, ['chatId', 'publishedAt', 'videoId'], {name: indexName});
  }
};
