// Review-only: migrate diff --from-empty reads this config, not an application DB.
// No credentials, no environment lookup, no migration is executed by this artifact.
export default {
  schema: './m0.schema.prisma',
  datasource: { url: 'file:./review-unused.db' },
};
