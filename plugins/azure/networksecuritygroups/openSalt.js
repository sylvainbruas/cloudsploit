const async = require('async');
const helpers = require('../../../helpers/azure');

module.exports = {
    title: 'Open Salt',
    category: 'Network Security Groups',
    domain: 'Network Access Control',
    severity: 'Critical',
    description: 'Determine if TCP ports 4505 or 4506 for the Salt master are open to the public',
    more_info: 'Active Salt vulnerabilities, CVE-2020-11651 and CVE-2020-11652 are exploiting Salt instances exposed to the internet. These ports should be closed immediately.',
    link: 'https://help.saltstack.com/hc/en-us/articles/360043056331-New-SaltStack-Release-Critical-Vulnerability',
    recommended_action: 'Restrict TCP ports 4505 and 4506 to known IP addresses',
    apis: ['networkSecurityGroups:listAll'],
    apis_remediate: ['networkSecurityGroups:listAll'],
    remediation_min_version: '202011201836',
    remediation_description: 'The impacted network security group rule will be deleted if no input is provided. If the failing port is in a port range and no input is provided, the range will be deleted. Otherwise, any input will replace the open CIDR rule.',
    remediation_inputs: {
        openSaltAzureReplacementIpAddress: {
            name: '(Optional) Replacement IPv4 CIDR',
            description: 'The IPv4 CIDR block used to replace the open IP rule',
            regex: '^([0-9]{1,3}\\.){3}[0-9]{1,3}(\\/([0-9]|[1-2][0-9]|3[0-2]))$',
            required: false
        },
        openSaltAzureReplacementIpv6Address: {
            name: '(Optional) Replacement IPv6 CIDR',
            description: 'The IPv6 CIDR block used to replace the open IP rule',
            regex: '^s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:)))(%.+)?s*(\\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))$',
            required: false
        }
    },
    actions: {remediate:['networkSecurityGroups:update'], rollback:['networkSecurityGroups:update']},
    permissions: {remediate: ['networkSecurityGroups:update'], rollback: ['networkSecurityGroups:update']},
    realtime_triggers: ['microsoftnetwork:networksecuritygroups:write','microsoftnetwork:networksecuritygroups:delete','microsoftnetwork:networksecuritygroups:securityrules:write','microsoftnetwork:networksecuritygroups:securityrules:delete'],

    run: function(cache, settings, callback) {
        const results = [];
        const source = {};
        const locations = helpers.locations(settings.govcloud);

        async.each(locations.networkSecurityGroups, function(location, rcb) {

            let networkSecurityGroups = helpers.addSource(
                cache, source, ['networkSecurityGroups', 'listAll', location]
            );

            if (!networkSecurityGroups) return rcb();

            if (networkSecurityGroups.err || !networkSecurityGroups.data) {
                helpers.addResult(results, 3, 'Unable to query for Network Security Groups: ' + helpers.addError(networkSecurityGroups), location);
                return rcb();
            }

            if (!networkSecurityGroups.data.length) {
                helpers.addResult(results, 0, 'No security groups found', location);
                return rcb();
            }

            var ports = {
                'TCP': [4505, 4506]
            };

            var service = 'Salt';

            helpers.findOpenPorts(networkSecurityGroups.data, ports, service, location, results);

            rcb();
        }, function() {
            callback(null, results, source);
        });
    },

    remediate: function(config, cache, settings, resource, callback) {
        var remediation_file = settings.remediation_file;
        var putCall = this.actions.remediate;

        // inputs specific to the plugin
        var pluginName = 'openSalt';
        var baseUrl = 'https://management.azure.com/{resource}?api-version=2020-05-01';
        var method = 'PUT';
        var protocols = ['TCP', '*'];
        var ports = [4505, 4506];
        var actions = [];
        var errors = [];
        helpers.remediateOpenPortsHelper( putCall, pluginName, protocols, ports, config, cache, settings, resource, remediation_file, baseUrl, method, actions, errors, callback);
    }
};