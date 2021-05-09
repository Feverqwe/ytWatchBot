import babel from 'rollup-plugin-babel';
import run from '@rollup/plugin-run';

const isWatch = process.argv.includes('-w');

export default {
  input: './src/main.js',
  output: {
    dir: './dist',
    format: 'cjs'
  },
  plugins: [
    babel({
      plugins: [
        ['@babel/plugin-proposal-class-properties', { "loose": true }]
      ]
    }),
    isWatch && run(/*{
      options: {
        execArgv: ['--inspect']
      }
    }*/),
  ]
};