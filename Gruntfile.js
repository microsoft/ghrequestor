module.exports = function (grunt) {
  grunt.file.setBase(__dirname);

  grunt.initConfig({
    mochaTest: {
      test: {
        src: ['test/**/*.js'],
        options: {
          clearRequireCache: true
        }
      }
    }
  });
  grunt.loadNpmTasks('grunt-mocha-test');
  grunt.registerTask('default', ['mochaTest']);
};