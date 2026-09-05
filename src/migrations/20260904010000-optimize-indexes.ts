import type {QueryInterface} from 'sequelize';
import type {Migration} from '../shared/migrator';

interface IndexDefinition {
  name: string;
  fields: string[];
}

interface TableIndexChanges {
  table: string;
  add: IndexDefinition[];
  remove: string[];
}

const applyIndexChanges = async (
  context: QueryInterface,
  changes: TableIndexChanges[],
): Promise<void> => {
  for (const {table, add, remove} of changes) {
    const indexes = (await context.showIndex(table)) as Array<{name: string}>;
    const existingNames = new Set(indexes.map(({name}) => name));

    for (const index of add) {
      if (existingNames.has(index.name)) continue;
      await context.addIndex(table, index.fields, {name: index.name});
      existingNames.add(index.name);
    }

    for (const name of remove) {
      if (!existingNames.has(name)) continue;
      await context.removeIndex(table, name);
      existingNames.delete(name);
    }
  }
};

const upChanges: TableIndexChanges[] = [
  {
    table: 'chatIdChannelId',
    add: [{name: 'chatId_createdAt_idx', fields: ['chatId', 'createdAt']}],
    remove: ['chatId_idx', 'createdAt_idx'],
  },
  {
    table: 'chatIdVideoId',
    add: [],
    remove: ['chatId_idx'],
  },
];

const downChanges: TableIndexChanges[] = [
  {
    table: 'chatIdChannelId',
    add: [
      {name: 'chatId_idx', fields: ['chatId']},
      {name: 'createdAt_idx', fields: ['createdAt']},
    ],
    remove: ['chatId_createdAt_idx'],
  },
  {
    table: 'chatIdVideoId',
    add: [{name: 'chatId_idx', fields: ['chatId']}],
    remove: [],
  },
];

export const up: Migration = ({context}) => applyIndexChanges(context, upChanges);

export const down: Migration = ({context}) => applyIndexChanges(context, downChanges);
