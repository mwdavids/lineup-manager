targetScope = 'subscription'

@minLength(1)
@description('Name of the azd environment; used to name the resource group and resources.')
param environmentName string

@minLength(1)
@description('Primary Azure region for the resource group and storage account.')
param location string

@description('Region for the Static Web App. Must be a region that supports Static Web Apps (Free). Defaults to eastus2.')
@allowed([
  'westus2'
  'centralus'
  'eastus2'
  'westeurope'
  'eastasia'
])
param staticWebAppLocation string = 'eastus2'

var tags = { 'azd-env-name': environmentName }
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  scope: rg
  name: 'resources'
  params: {
    location: location
    staticWebAppLocation: staticWebAppLocation
    resourceToken: resourceToken
    tags: tags
  }
}

output AZURE_LOCATION string = location
output RESOURCE_GROUP string = rg.name
output SERVICE_WEB_NAME string = resources.outputs.staticWebAppName
output WEB_URI string = resources.outputs.staticWebAppUri
output STATIC_WEB_APP_URL string = resources.outputs.staticWebAppUri
