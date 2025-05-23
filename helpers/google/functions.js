var async = require('async');
var shared = require(__dirname + '/../shared.js');

var disabledKeywords = ['has not been used', 'it is disabled'];

function addResult(results, status, message, region, resource, custom, err, required) {
    var pushResult = function(status, message, region, resource, custom) {
        results.push({
            status: status,
            message: message,
            region: region || 'global',
            resource: resource || null,
            custom: custom || false
        });
    };

    var processError = function(errorObj) {
        if (errorObj &&
            errorObj.code &&
            errorObj.code == 404) {
            pushResult(0, 'Project is deleted or pending deletion.', region, resource, custom);
        } else if (errorObj &&
            errorObj.code &&
            errorObj.code == 403 &&
            errorObj.message &&
            disabledKeywords.some(substring=>errorObj.message.includes(substring))) {
            pushResult(required ? 2 : 0, required ? 'Service is not enabled, but it is recommended to run a secure workload in GCP.' : 'Service is not enabled', region, resource, custom);
        } else if (errorObj &&
            errorObj.code &&
            errorObj.code == 403 &&
            errorObj.errors &&
            errorObj.errors.length) {
            errorObj.errors.forEach(function(errError){
                if (errError &&
                    errError.message &&
                    disabledKeywords.some(substring=>errError.message.includes(substring))){
                    pushResult(required ? 2 : 0, required ? 'Service is not enabled, but it is recommended to run a secure workload in GCP.' : 'Service is not enabled', region, resource, custom);
                } else {
                    pushResult(3, (errError.message ? errError.message : message), region, resource, custom);
                }
            });

        } else {
            pushResult(3, (errorObj.message ? errorObj.message : 'Unable to query the API: ' + errorObj), region, resource, custom);
        }
    };

    if (err &&
        err.code) {
        processError(err);
    } else if (err &&
        err[region] &&
        err[region].length) {
        err[region].forEach(function(errRegion) {
            if (errRegion &&
                err[region][errRegion] &&
                err[region][errRegion].code) {
                processError(err[region][errRegion]);
            } else {
                pushResult(3, (err[region][errRegion].message ? err[region][errRegion].message : message), region, resource, custom);
            }
        });
    } else if (message &&
        disabledKeywords.some(substring=>message.includes(substring))) {
        pushResult(required ? 2 : 0, required ? 'Service is not enabled, but it is recommended to run a secure workload in GCP.' : 'Service is not enabled', region, resource, custom);
    } else {
        pushResult(status, message, region, resource, custom);
    }
}

function findOpenPorts(ngs, protocols, service, location, results, cache, source) {
    let projects = shared.addSource(cache, source,
        ['projects','get', 'global']);

    if (!projects || projects.err || !projects.data || !projects.data.length) {
        addResult(results, 3,
            'Unable to query for projects: ' + shared.addError(projects), 'global', null, null, (projects) ? projects.err : null);
        return;
    }

    var project = projects.data[0].name;
    for (let sgroups of ngs) {
        let strings = [];
        let resource = createResourceName('firewalls', sgroups.name, project, 'global');
        if (sgroups.allowed && sgroups.allowed.length) {
            let firewallRules = sgroups.allowed;
            let sourceAddressPrefix = sgroups.sourceRanges;

            if (!sourceAddressPrefix || !sourceAddressPrefix.length) continue;

            for (let firewallRule of firewallRules) {
                for (let protocol in protocols) {
                    let ports = protocols[protocol];

                    for (let port of ports) {
                        if (sgroups['direction'] && (sgroups['direction'] === 'INGRESS') &&
                            firewallRule['IPProtocol'] && (firewallRule['IPProtocol'] === protocol) &&
                            !sgroups['disabled'] &&
                            (sourceAddressPrefix.includes('*') || sourceAddressPrefix.includes('') || sourceAddressPrefix.includes('0.0.0.0/0') || sourceAddressPrefix.includes('<nw>/0') || sourceAddressPrefix.includes('/0') || sourceAddressPrefix.includes('internet'))) {
                            var sourcefilter = (sourceAddressPrefix === '0.0.0.0/0' ? 'any IP' : sourceAddressPrefix);
                            if (firewallRule['ports']) {
                                firewallRule['ports'].forEach((portRange) => {
                                    if (portRange.includes("-")) {
                                        portRange = portRange.split("-");
                                        let startPort = portRange[0];
                                        let endPort = portRange[1];
                                        if (parseInt(startPort) < port && parseInt(endPort) > port) {
                                            var string = `` + (protocol === '*' ? `All protocols` : protocol.toUpperCase()) +
                                                ` port ` + port + ` open to ` + sourcefilter; strings.push(string);
                                            if (strings.indexOf(string) === -1) strings.push(string);
                                        }
                                    } else if (parseInt(portRange) === port) {
                                        var string = `` + (protocol === '*' ? `All protocols` : protocol.toUpperCase()) +
                                            ` port ` + port + ` open to ` + sourcefilter;
                                        if (strings.indexOf(string) === -1) strings.push(string);
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }
        if (strings.length) {
            shared.addResult(results, 2,
                'Firewall Rule:(' + sgroups.name +
                ') has ' + service + ': ' + strings.join(' and '), location,
                resource);
        }
        else {
            shared.addResult(results, 0,
                'Firewall Rule:(' + sgroups.name +
                ') does not have ' + service + ' port open ' , location,
                resource);
        }
    }
}

function findOpenAllPorts(ngs, location, results, cache, source) {
    let projects = shared.addSource(cache, source,
        ['projects','get', 'global']);

    if (!projects || projects.err || !projects.data || !projects.data.length) {
        addResult(results, 3,
            'Unable to query for projects: ' + shared.addError(projects), 'global', null, null, (projects) ? projects.err : null);
        return;
    }

    var project = projects.data[0].name;
    let protocols = {'tcp': '*', 'udp' : '*'};
    for (let sgroups of ngs) {
        let strings = [];
        let resource = createResourceName('firewalls', sgroups.name, project, 'global');
        if (sgroups.allowed && sgroups.allowed.length) {
            let firewallRules = sgroups.allowed;
            let sourceAddressPrefix = sgroups.sourceRanges;

            if (!sourceAddressPrefix || !sourceAddressPrefix.length) continue;

            for (let firewallRule of firewallRules) {
                for (let protocol in protocols) {
                    if (sgroups['direction'] && (sgroups['direction'] === 'INGRESS') &&
                        firewallRule['IPProtocol'] && (firewallRule['IPProtocol'] === protocol) &&
                        !sgroups['disabled'] &&
                        sourceAddressPrefix &&
                        (sourceAddressPrefix.includes('*') || sourceAddressPrefix.includes('') || sourceAddressPrefix.includes('0.0.0.0/0') || sourceAddressPrefix.includes('<nw>/0') || sourceAddressPrefix.includes('/0') || sourceAddressPrefix.includes('internet'))) {
                        if (firewallRule['ports']) {
                            firewallRule['ports'].forEach((portRange) => {
                                if (portRange.includes("-")) {
                                    portRange = portRange.split("-");
                                    let startPort = portRange[0];
                                    let endPort = portRange[1];
                                    if (parseInt(startPort) === 0 && parseInt(endPort) === 65535) {
                                        var string = 'all ports open to the public';
                                        if (strings.indexOf(string) === -1) strings.push(string);
                                    }
                                } else if (portRange === 'all') {
                                    var string = 'all ports open to the public';
                                    if (strings.indexOf(string) === -1) strings.push(string);
                                }
                            });
                        }
                    } else if (sgroups['direction'] && (sgroups['direction'] === 'INGRESS') &&
                        firewallRule['IPProtocol'] && (firewallRule['IPProtocol'] === 'all') &&
                        !sgroups['disabled'] &&
                        sourceAddressPrefix &&
                        (sourceAddressPrefix.includes('*') || sourceAddressPrefix.includes('') || sourceAddressPrefix.includes('0.0.0.0/0') || sourceAddressPrefix.includes('<nw>/0') || sourceAddressPrefix.includes('/0') || sourceAddressPrefix.includes('internet'))) {
                        var string = 'all ports open to the public';
                        if (strings.indexOf(string) === -1) strings.push(string);
                    }
                }
            }
        }
        if (strings.length) {
            shared.addResult(results, 2,
                'Firewall Rule:(' + sgroups.name +
                ') has ' + strings.join(' and '), location,
                resource);
        }
        else {
            shared.addResult(results, 0,
                'Firewall Rule:(' + sgroups.name +
                ') does not have all ports open to the public', location,
                resource);
        }
    }
}

function findOpenAllPortsEgress(ngs, location, results, cache, source) {
    let projects = shared.addSource(cache, source,
        ['projects','get', 'global']);

    if (!projects || projects.err || !projects.data || !projects.data.length) {
        addResult(results, 3,
            'Unable to query for projects: ' + shared.addError(projects), 'global', null, null, (projects) ? projects.err : null);
        return;
    }

    var project = projects.data[0].name;
    let protocols = {'tcp': '*', 'udp' : '*'};
    for (let sgroups of ngs) {
        let strings = [];
        let resource = createResourceName('firewalls', sgroups.name, project, 'global');
        if (sgroups.allowed && sgroups.allowed.length) {
            let firewallRules = sgroups.allowed;
            let destAddressPrefix = sgroups.destinationRanges;

            if (!destAddressPrefix || !destAddressPrefix.length) continue;

            for (let firewallRule of firewallRules) {
                for (let protocol in protocols) {
                    if (sgroups['direction'] && (sgroups['direction'] === 'EGRESS') &&
                        firewallRule['IPProtocol'] && (firewallRule['IPProtocol'] === protocol) &&
                        !sgroups['disabled'] &&
                        destAddressPrefix &&
                        (destAddressPrefix.includes('*') || destAddressPrefix.includes('') || destAddressPrefix.includes('0.0.0.0/0') || destAddressPrefix.includes('<nw>/0') || destAddressPrefix.includes('/0') || destAddressPrefix.includes('internet'))) {
                        if (firewallRule['ports']) {
                            firewallRule['ports'].forEach((portRange) => {
                                if (portRange.includes("-")) {
                                    portRange = portRange.split("-");
                                    let startPort = portRange[0];
                                    let endPort = portRange[1];
                                    if (parseInt(startPort) === 0 && parseInt(endPort) === 65535) {
                                        var string = 'all ports open to the public';
                                        if (strings.indexOf(string) === -1) strings.push(string);
                                    }
                                } else if (portRange === 'all') {
                                    var string = 'all ports open to the public';
                                    if (strings.indexOf(string) === -1) strings.push(string);
                                }
                            });
                        }
                    } else if (sgroups['direction'] && (sgroups['direction'] === 'EGRESS') &&
                        firewallRule['IPProtocol'] && (firewallRule['IPProtocol'] === 'all') &&
                        !sgroups['disabled'] &&
                        destAddressPrefix &&
                        (destAddressPrefix.includes('*') || destAddressPrefix.includes('') || destAddressPrefix.includes('0.0.0.0/0') || destAddressPrefix.includes('<nw>/0') || destAddressPrefix.includes('/0') || destAddressPrefix.includes('internet'))) {
                        var string = 'all ports open to the public';
                        if (strings.indexOf(string) === -1) strings.push(string);
                    }
                }
            }
        }
        if (strings.length) {
            shared.addResult(results, 2,
                'Firewall Rule:(' + sgroups.name +
                ') has ' + strings.join(' and '), location,
                resource);
        }
        else {
            shared.addResult(results, 0,
                'Firewall Rule:(' + sgroups.name +
                ') does not have all ports open to the public', location,
                resource);
        }
    }
}

function hasBuckets(buckets){
    if(buckets.length &&
        Object.keys(buckets[0]).length>1) {
        return true;
    } else {
        return false;
    }
}

function createResourceName(resourceType, resourceId, project, locationType, location) {
    let resourceName = '';
    if (project) resourceName = `projects/${project}/`;
    switch(locationType) {
        case 'global':
            resourceName = `${resourceName}global/${resourceType}/${resourceId}`;
            break;
        case 'region':
            resourceName = `${resourceName}regions/${location}/${resourceType}/${resourceId}`;
            break;
        case 'zone':
            resourceName = `${resourceName}zones/${location}/${resourceType}/${resourceId}`;
            break;
        case 'location':
            resourceName = `${resourceName}locations/${location}/${resourceType}/${resourceId}`;
            break;
        default:
            resourceName = `${resourceName}${resourceType}/${resourceId}`;
    }
    return resourceName;
}

function getProtectionLevel(cryptographickey, encryptionLevels) {
    if (cryptographickey && cryptographickey.versionTemplate && cryptographickey.versionTemplate.protectionLevel) {
        if (cryptographickey.versionTemplate.protectionLevel == 'SOFTWARE') return encryptionLevels.indexOf('cloudcmek');
        else if (cryptographickey.versionTemplate.protectionLevel == 'HSM') return encryptionLevels.indexOf('cloudhsm');
        else if (cryptographickey.versionTemplate.protectionLevel == 'EXTERNAL') return encryptionLevels.indexOf('external');
    }

    return encryptionLevels.indexOf('unspecified');
}

function listToObj(resultObj, listData, onKey) {
    async.each(listData, function(entry, cb){
        if (entry[onKey]) resultObj[entry[onKey]] = entry;
        cb();
    });
}

function createResourceName(resourceType, resourceId, project, locationType, location) {
    let resourceName = '';
    if (project) resourceName = `projects/${project}/`;
    switch(locationType) {
        case 'global':
            resourceName = `${resourceName}global/${resourceType}/${resourceId}`;
            break;
        case 'region':
            resourceName = `${resourceName}regions/${location}/${resourceType}/${resourceId}`;
            break;
        case 'zone':
            resourceName = `${resourceName}zones/${location}/${resourceType}/${resourceId}`;
            break;
        case 'location':
            resourceName = `${resourceName}locations/${location}/${resourceType}/${resourceId}`;
            break;
        default:
            resourceName = `${resourceName}${resourceType}/${resourceId}`;
    }
    return resourceName;
}

function checkOrgPolicy(orgPolicies, constraintName, constraintType, shouldBeEnabled, ifNotFound, displayName, results, resource) {
    let isEnabled = false;
    if (orgPolicies && orgPolicies.policies) {
        let policyToCheck = orgPolicies.policies.find(policy => (
            policy.constraint &&
            policy.constraint.includes(constraintName)));
        if (policyToCheck) {
            if (constraintType == 'listPolicy' && policyToCheck.listPolicy) {
                if (policyToCheck.listPolicy.allValues) {
                    isEnabled = policyToCheck.listPolicy.allValues == 'ALLOW' ? false : true;
                } else if ((policyToCheck.listPolicy.allowedValues && policyToCheck.listPolicy.allowedValues.length) || (policyToCheck.listPolicy.deniedValues && policyToCheck.listPolicy.deniedValues.length)) {
                    isEnabled = true;
                }
            } else if (constraintType == 'booleanPolicy' && policyToCheck.booleanPolicy && policyToCheck.booleanPolicy.enforced) {
                isEnabled = true;
            }
        } else {
            isEnabled = ifNotFound;
        }
    }
    let successMessage = `"${displayName}" constraint is enforced at the organization level.`;
    let failureMessage = `"${displayName}" constraint is not enforced at the organization level.`;
    let status, message;
    if (isEnabled) {
        status = shouldBeEnabled ? 0 : 2;
        message = shouldBeEnabled ? successMessage : failureMessage;
    } else {
        status = shouldBeEnabled ? 2 : 0;
        message = shouldBeEnabled ? failureMessage : successMessage;
    }

    shared.addResult(results, status, message, 'global', resource);

}

function checkIAMRole(iamPolicy, roles, region, results, project, notFoundMessage) {
    let roleExists = false;
    if (iamPolicy && iamPolicy.bindings && iamPolicy.bindings.length) {
        iamPolicy.bindings.forEach(roleBinding => {
            if (roleBinding.role && roles.includes(roleBinding.role)) {
                roleExists = true;
                roleBinding.members.forEach(member => {
                    let accountName = (member.includes(':')) ? member.split(':')[1] : member;
                    let memberType = member.startsWith('serviceAccount') ? 'serviceAccounts' : 'users';
                    let resource = createResourceName(memberType, accountName, project);
                    shared.addResult(results, 2,
                        `The account has the pre-defined role: ${roleBinding.role}`, region, resource);
                });
            }
        });
    }
    if (!roleExists) {
        shared.addResult(results, 0, notFoundMessage, region);
    }
}

function checkFirewallRules(firewallRules) {
    firewallRules.sort((a, b) => (a.priority || 1000) - (b.priority || 1000));

    for (const firewallRule of firewallRules) {
        if (firewallRule.direction !== 'INGRESS' || firewallRule.disabled) {
            continue;
        }

        const networkName = firewallRule.network ? firewallRule.network.split('/').pop() : '';

        let allSources = firewallRule.sourceRanges? firewallRule.sourceRanges.some(sourceAddressPrefix =>
            sourceAddressPrefix === '*' ||
            sourceAddressPrefix === '0.0.0.0/0' ||
            sourceAddressPrefix === '::/0' ||
            sourceAddressPrefix.includes('/0') ||
            sourceAddressPrefix.toLowerCase() === 'internet' ||
            sourceAddressPrefix.includes('<nw>/0')
        ): false;

        var allowed = firewallRule.allowed? firewallRule.allowed.some(allow => !!allow.IPProtocol): false;
        var denied = firewallRule.denied? firewallRule.denied.some(deny => deny.IPProtocol === 'all'): false;
        if (allSources && allowed) {
            return {exposed: true, networkName: `vpc ${networkName}`};
        }

        if (allSources && denied) {
            return {exposed: false};
        }
    }

    return {exposed: true};


}

function getForwardingRules(cache, source, region, resource) {
    let rules = [];

    let forwardingRules = getAllDataForService(cache, source, 'forwardingRules', 'list', region);
    let backendServices = getAllDataForService(cache, source, 'backendServices', 'list', region);
    let targetHttpProxies = getAllDataForService(cache, source, 'targetHttpProxies', 'list', region);
    let targetHttpsProxies = getAllDataForService(cache, source, 'targetHttpsProxies', 'list', region);
    let urlMaps = getAllDataForService(cache, source, 'urlMaps', 'list', region);

    if (!forwardingRules || !forwardingRules.length || !backendServices || !backendServices.length) {
        return [];
    }

    if (resource.httpsTrigger && resource.httpsTrigger.url) {
        backendServices = backendServices.filter(service => {
            if (service.backends && service.backends.length) {
                return service.backends.some(backend => backend.target && backend.target.includes(resource.httpsTrigger.url));
            }
        });
    } else {
        backendServices = backendServices.filter(service => {
            if (service.backends && service.backends.length) {
                return service.backends.some(backend => {
                    let group = backend.group.replace(/^.*?(\/projects\/.*)$/, '$1');
                    return (resource.selfLink && resource.selfLink.includes(group));
                });
            }
        });
    }

    if (backendServices && backendServices.length) {
        forwardingRules.forEach(rule => {
            let rulePath = `FR ${rule.name}`;
            let targetProxyLink = '';
            let urlMapLink = '';
            let backendServiceLink = '';

            if (rule.target && (rule.target.includes('targetHttpProxies') || rule.target.includes('targetHttpsProxies'))) {
                let target = rule.target.replace(/^.*?(\/projects\/.*)$/, '$1');
                let targetProxy = rule.target.includes('targetHttpProxies')
                    ? targetHttpProxies.find(proxy => proxy.selfLink.includes(target))
                    : targetHttpsProxies.find(proxy => proxy.selfLink.includes(target));

                if (targetProxy) {
                    rulePath += ` > TP ${targetProxy.name}`;
                    targetProxyLink = targetProxy.selfLink;

                    if (targetProxy.urlMap) {
                        let urlMap = urlMaps.find(map => map.selfLink.includes(targetProxy.urlMap.replace(/^.*?(\/projects\/.*)$/, '$1')));
                        if (urlMap && urlMap.defaultService) {
                            rulePath += ` > UM ${urlMap.name}`;
                            urlMapLink = urlMap.selfLink;

                            let serviceName = urlMap.defaultService.replace(/^.*?(\/projects\/.*)$/, '$1');
                            let matchedBackendService = backendServices.find(service => service.selfLink.includes(serviceName));

                            if (matchedBackendService) {
                                rulePath += ` > BS ${matchedBackendService.name}`;
                                backendServiceLink = matchedBackendService.selfLink;
                            }
                        }
                    } else {
                        let matchedBackendService = backendServices.find(service => targetProxy.selfLink.includes(service.selfLink.replace(/^.*?(\/projects\/.*)$/, '$1')));

                        if (matchedBackendService) {
                            rulePath += ` > BS ${matchedBackendService.name}`;
                            backendServiceLink = matchedBackendService.selfLink;
                        }
                    }
                }
            } else if (rule.backendService) {
                let serviceName = rule.backendService.replace(/^.*?(\/projects\/.*)$/, '$1');
                let matchedBackendService = backendServices.find(service => service.selfLink.includes(serviceName));

                if (matchedBackendService) {
                    rulePath += ` > BS ${matchedBackendService.name}`;
                    backendServiceLink = matchedBackendService.selfLink;
                }
            }

            if (backendServiceLink) {
                rules.push({ ...rule, rulePath });
            }
        });
    }
    return rules;
}


function getAllDataForService(cache, source, service, call, region) {
    let allData = [];

    let globalData = shared.addSource(cache, source, [service, call, 'global']);
    let regionalData = shared.addSource(cache, source, [service, call, region]);


    if (globalData && !globalData.err && globalData.data && globalData.data.length) {
        allData = allData.concat(globalData.data);
    }

    if (regionalData && !regionalData.err && regionalData.data && regionalData.data.length) {
        allData = allData.concat(regionalData.data);
    }
    return allData;
}

function checkClusterExposure(cluster) {
    const privateClusterConfig = cluster.privateClusterConfig || {};
    const masterAuthorizedNetworksConfig = cluster.masterAuthorizedNetworksConfig || {};

    const cidrBlocks = masterAuthorizedNetworksConfig.cidrBlocks || [];

    const publicCidrPatterns = ['0.0.0.0/0', '::/0', '*', '::0'];

    const hasPublicCIDR = cidrBlocks.some(block =>  publicCidrPatterns.includes(block));

    return (
        (!privateClusterConfig.enablePrivateEndpoint && privateClusterConfig.publicEndpoint) ||    // Public endpoint with no private endpoint
        masterAuthorizedNetworksConfig.gcpPublicCidrsAccessEnabled ||                   // Google Cloud public IPs are allowed
        hasPublicCIDR                                    // If there is a public CIDR like 0.0.0.0/0, ::/0, or *
    );
}

function checkNetworkExposure(cache, source, networks, firewallRules, region, results, forwardingRules)  {
    let exposedPath = '';

    if (firewallRules && firewallRules.length) {
        // Scenario 1: check if any firewall rule allows all inbound traffic
        let isExposed = checkFirewallRules(firewallRules);
        if (isExposed.exposed) {
            if (isExposed.networkName) {
                return isExposed.networkName;
            }
        } else {
            return '';
        }
    }

    // load balancing flow
    if (forwardingRules && forwardingRules.length) {
        for (let rule of forwardingRules) {
            let ipAddress = rule.IPAddress;
            if ((rule.loadBalancingScheme === 'EXTERNAL' || rule.loadBalancingScheme === 'EXTERNAL_MANAGED') &&
                (ipAddress && !ipAddress.startsWith('10.') && !ipAddress.startsWith('192.168.') && !ipAddress.startsWith('172.'))) {
                exposedPath =  rule.rulePath || rule.name;
                break;

            }
        }
    }
    return exposedPath
}
module.exports = {
    addResult: addResult,
    findOpenPorts: findOpenPorts,
    findOpenAllPorts: findOpenAllPorts,
    hasBuckets: hasBuckets,
    createResourceName: createResourceName,
    getProtectionLevel: getProtectionLevel,
    listToObj: listToObj,
    createResourceName: createResourceName,
    checkOrgPolicy: checkOrgPolicy,
    checkIAMRole: checkIAMRole,
    findOpenAllPortsEgress: findOpenAllPortsEgress,
    checkNetworkExposure: checkNetworkExposure,
    getForwardingRules: getForwardingRules,
    checkClusterExposure: checkClusterExposure,
    checkFirewallRules: checkFirewallRules
};
