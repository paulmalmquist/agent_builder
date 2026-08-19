export const REUSE_V1_ROUTES = Object.freeze({
  catalogPublications: '/v1/catalog/publications',
  catalogPublication: '/v1/catalog/publications/:publicationId',
  catalogPublicationRetirement: '/v1/catalog/publications/:publicationId/retirement',
  builderIntakes: '/v1/builder/intakes',
  builderIntake: '/v1/builder/intakes/:intakeId',
  builderIntakeChoices: '/v1/builder/intakes/:intakeId/referred-choices',
  builderDecisions: '/v1/builder/intakes/:intakeId/decisions',
  builderDraft: '/v1/builder/drafts/:draftId',
  deployments: '/v1/deployments',
  deployment: '/v1/deployments/:deploymentId',
  configurationRevisions: '/v1/deployments/:deploymentId/configuration-revisions',
  resourceLineage: '/v1/resources/:resourceVersionId/lineage',
} as const);

export const REUSE_OPENAPI_OPERATION_IDS = Object.freeze({
  listCatalogPublications: 'listCatalogPublications',
  getCatalogPublication: 'getCatalogPublication',
  retireCatalogPublication: 'retireCatalogPublication',
  createBuilderIntake: 'createBuilderIntake',
  getBuilderIntake: 'getBuilderIntake',
  listReferredChoices: 'listReferredChoices',
  createBuilderDecision: 'createBuilderDecision',
  getBuilderDraft: 'getBuilderDraft',
  createDeployment: 'createDeployment',
  getDeployment: 'getDeployment',
  appendConfigurationRevision: 'appendConfigurationRevision',
  getResourceLineage: 'getResourceLineage',
} as const);

export type ReuseV1RouteName = keyof typeof REUSE_V1_ROUTES;
export type ReuseOpenApiOperationId =
  (typeof REUSE_OPENAPI_OPERATION_IDS)[keyof typeof REUSE_OPENAPI_OPERATION_IDS];
