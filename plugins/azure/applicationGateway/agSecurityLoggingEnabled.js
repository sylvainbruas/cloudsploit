const async = require('async');
const helpers = require('../../../helpers/azure');

module.exports = {
    title: 'Application Gateway Security Logging Enabled',
    category: 'Application Gateway',
    domain: 'Network Access Control',
    description: 'Ensures that Application Gateway Access and Firewall logs are enabled.',
    more_info: 'Application Gateway access logs helps to analyze important information including the caller\'s IP, requested URL, response latency, return code, and bytes in and out. Web application firewall (WAF) logs can be used to detect potential attacks, and false positive detections that might indicate legitimate requests that the WAF blocked.',
    recommended_action: 'Modify Application Gateway and add diagnostic settings for Access and Firewall Logs.',
    link: 'https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-diagnostics',
    apis: ['applicationGateway:listAll', 'diagnosticSettings:listByApplicationGateways'],

    run: function (cache, settings, callback) {
        const results = [];
        const source = {};
        const locations = helpers.locations(settings.govcloud);
        async.each(locations.applicationGateway, (location, rcb) => {
            const applicationGateways = helpers.addSource(cache, source,
                ['applicationGateway', 'listAll', location]);

            if (!applicationGateways) return rcb();

            if (applicationGateways.err || !applicationGateways.data) {
                helpers.addResult(results, 3,
                    'Unable to query Application Gateway: ' + helpers.addError(applicationGateways), location);
                return rcb();
            }

            if (!applicationGateways.data.length) {
                helpers.addResult(results, 0, 'No existing Application Gateway found', location);
                return rcb();
            }

            applicationGateways.data.forEach(function (appGateway) {
                if (!appGateway.id) return;
                const diagnosticSettings = helpers.addSource(cache, source,
                    ['diagnosticSettings', 'listByApplicationGateways', location, appGateway.id]);

                if (!diagnosticSettings || diagnosticSettings.err || !diagnosticSettings.data) {
                    helpers.addResult(results, 3, 'Unable to query Application Gateway diagnostics settings: ' + helpers.addError(diagnosticSettings), location, appGateway.id);
                } else {

                    var logs = diagnosticSettings.data[0] && diagnosticSettings.data[0].logs ? diagnosticSettings.data[0].logs : [];
                    
                    const allLogsEnabled = logs.some(log => log.categoryGroup === 'allLogs' && log.enabled);
                    const requiredLogs = ['ApplicationGatewayAccessLog', 'ApplicationGatewayFirewallLog'];
                    const missingLogs = requiredLogs.filter(requiredCategory =>
                        !logs.find(log => (log.category === requiredCategory && log.enabled))
                    );

                    if (!allLogsEnabled && missingLogs.length) {
                        helpers.addResult(results, 2, `Application Gateway does not have security logging enabled. Missing Logs ${missingLogs}`, location, appGateway.id);
                    } else {
                        helpers.addResult(results, 0, 'Application Gateway has security logging enabled', location, appGateway.id);
                    }



                }
            });

            rcb();
        }, function () {
            callback(null, results, source);
        });
    }
};