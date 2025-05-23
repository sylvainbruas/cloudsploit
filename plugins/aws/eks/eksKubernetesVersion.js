var async = require('async');
var helpers = require('../../../helpers/aws');

module.exports = {
    title: 'EKS Kubernetes Version',
    category: 'EKS',
    domain: 'Containers',
    severity: 'Low',
    description: 'Ensures the latest version of Kubernetes is installed on EKS clusters',
    more_info: 'EKS supports provisioning clusters from several versions of Kubernetes. Clusters should be kept up to date to ensure Kubernetes security patches are applied.',
    link: 'https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html',
    recommended_action: 'Upgrade the version of Kubernetes on all EKS clusters to the latest available version.',
    apis: ['EKS:listClusters', 'EKS:describeCluster', 'STS:getCallerIdentity'],
    realtime_triggers: ['eks:CreateCluster', 'eks:UpdateClusterVersion', 'eks:DeleteCluster'],

    run: function(cache, settings, callback) {
        var results = [];
        var source = {};
        var regions = helpers.regions(settings);

        var acctRegion = helpers.defaultRegion(settings);
        var awsOrGov = helpers.defaultPartition(settings);
        var accountId = helpers.addSource(cache, source, ['sts', 'getCallerIdentity', acctRegion, 'data']);

        var deprecatedVersions = {
            '1.10': '2019-07-22',
            '1.11': '2019-11-04',
            '1.12': '2020-05-11',
            '1.13': '2020-06-30',
            '1.14': '2020-12-08',
            '1.15': '2021-05-03',
            '1.16': '2021-09-27',
            '1.17': '2021-11-02',
            '1.18': '2022-03-31',
            '1.19': '2022-08-01',
            '1.20': '2022-11-01',
            '1.21': '2023-02-16',
            '1.22': '2023-06-04',
            '1.23': '2023-10-11',
            '1.24': '2024-01-31',
            '1.25': '2024-05-01',
            '1.26': '2024-06-11',
            '1.27': '2024-07-24',
            '1.28': '2024-11-26',
            '1.29': '2025-03-23',
            '1.30': '2025-07-23',
            '1.31': '2025-11-26',
            '1.32': '2026-03-23'
        };

        var outdatedVersions = {
        };

        async.each(regions.eks, function(region, rcb) {
            var listClusters = helpers.addSource(cache, source,
                ['eks', 'listClusters', region]);

            if (!listClusters) return rcb();

            if (listClusters.err || !listClusters.data) {
                helpers.addResult(
                    results, 3,
                    'Unable to query for EKS clusters: ' + helpers.addError(listClusters), region);
                return rcb();
            }

            if (listClusters.data.length === 0){
                helpers.addResult(results, 0, 'No EKS clusters present', region);
                return rcb();
            }

            for (var c in listClusters.data) {
                var clusterName = listClusters.data[c];
                var describeCluster = helpers.addSource(cache, source,
                    ['eks', 'describeCluster', region, clusterName]);

                var arn = 'arn:' + awsOrGov + ':eks:' + region + ':' + accountId + ':cluster/' + clusterName;

                if (!describeCluster || describeCluster.err || !describeCluster.data) {
                    helpers.addResult(
                        results, 3,
                        'Unable to describe EKS cluster: ' + helpers.addError(describeCluster),
                        region, arn);
                    continue;
                }

                if (describeCluster.data.cluster &&
                    describeCluster.data.cluster.version) {
                    var version = describeCluster.data.cluster.version;
                    let versionDeprecationDate = (deprecatedVersions[version]) ? deprecatedVersions[version] : null;
                    let versionOutdatedDate = (outdatedVersions[version]) ? outdatedVersions[version] : null;
                    let today = new Date();
                    let dateToday = (today.getDate() < 10) ? '0' + today.getDate() : today.getDate();
                    let month = (today.getMonth() < 10) ? '0' + (today.getMonth()+1) : today.getMonth();
                    today = `${today.getFullYear()}-${month}-${dateToday}`;

                    if (versionDeprecationDate && today > versionDeprecationDate) {
                        helpers.addResult(results, 2,
                            'EKS cluster is running Kubernetes: ' + version + ' which was deprecated on: ' + deprecatedVersions[version],
                            region, arn);
                    } else if (versionOutdatedDate && today > versionOutdatedDate) {
                        helpers.addResult(results, 1,
                            'EKS cluster is running Kubernetes: ' + version + ' which is currently outdated',
                            region, arn);
                    } else {
                        helpers.addResult(results, 0,
                            'EKS cluster is running a current version of Kubernetes: ' + version,
                            region, arn);
                    }
                } else {
                    helpers.addResult(results, 2, 'Unknown Kubernetes version found', region, arn);
                }
            }

            rcb();
        }, function() {
            callback(null, results, source);
        });
    }
};