import babel from 'rollup-plugin-babel';

export default {
  input: './src/main.js',
  output: {
    dir: './dist',
    format: 'cjs'
  },
  plugins: [
    babel({
      presets: [
        ['@babel/preset-env', {
          useBuiltIns: 'usage',
          corejs: {
            version: 3,
            proposals: true
          },
          targets: {
            node: 'current'
          },
          include: [
            'es.promise.finally',
            'esnext.promise.try',
          ]
        }]
      ],
      plugins: [
        ['@babel/plugin-proposal-class-properties', { "loose": true }]
      ]
    })
  ]
};