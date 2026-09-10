@description('Primary region for the storage account.')
param location string

@description('Region for the Static Web App (must support SWA Free).')
param staticWebAppLocation string

@description('Unique-ish token for resource names.')
param resourceToken string

param tags object

// ---- Storage (one private blob container holds one JSON doc per team) ----
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'st${resourceToken}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
}

resource teamContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'teamdata'
  properties: { publicAccess: 'None' }
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

// ---- Static Web App (Free) with managed Functions API from ./api ----
resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'swa-${resourceToken}'
  location: staticWebAppLocation
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
    provider: 'Custom'
    buildProperties: {
      appLocation: '/'
      apiLocation: 'api'
      outputLocation: ''
    }
  }
}

// The storage connection string lives ONLY in the managed API's server-side app
// settings — never shipped to the browser.
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    AZURE_STORAGE_CONNECTION_STRING: storageConnectionString
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppUri string = 'https://${staticWebApp.properties.defaultHostname}'
output storageAccountName string = storage.name
