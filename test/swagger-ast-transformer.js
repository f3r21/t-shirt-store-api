/**
 * Adapter so ts-jest can run the Nest Swagger compiler plugin.
 *
 * `nest build` applies that plugin, and it is what turns a bare DTO class into a
 * schema with properties: without it `CreateProductDto` compiles to an empty
 * object. ts-jest applies no such plugin, so a spec comparing the generated
 * document against the contract would compare 11 hollow schemas against 17 real
 * ones and fail for a reason that has nothing to do with the code.
 *
 * The two interfaces do not line up. `@nestjs/swagger/plugin` exports `before`,
 * while ts-jest expects a module exporting `name`, `version` and `factory`. This
 * is the four lines that join them, so the document a test sees is the document
 * the server serves.
 *
 * Options are duplicated from `nest-cli.json` on purpose. There is no shared
 * config file the Nest CLI and ts-jest both read, so the honest choice is to
 * write them twice and say so rather than to pretend one source exists.
 */
const { before } = require('@nestjs/swagger/plugin');

module.exports.name = 'nestjs-swagger-plugin';
module.exports.version = 1;
module.exports.factory = (compilerService) =>
  before(
    {
      classValidatorShim: true,
      introspectComments: true,
      dtoFileNameSuffix: ['.dto.ts'],
      controllerFileNameSuffix: ['.controller.ts'],
    },
    compilerService.program,
  );
