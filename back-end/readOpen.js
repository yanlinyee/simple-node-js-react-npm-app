const readYamlFile = require('read-yaml-file');
const writeYamlFile = require('write-yaml-file');
const fs = require('fs');
const path = require('path');

var res = {};
var schemas = {};
var paths = {};
var storage = [];

const conversion = function (data, location) {
    for (let [dataKey, dataVal] of Object.entries(data)) {
        switch (location) {
            case 'schemas':
                properties = dataVal['properties'];
                break;
            case 'paths':
                dataVal['name'] = dataKey;
                properties = dataVal['get'];
                break;
            default:
                properties = undefined;
        }
        if (properties) {
            extractItems(properties);
        }
    }
}

const extractItems = function (properties) {
    for (let [propertyKey, propertyVal] of Object.entries(properties)) {
        if (propertyVal['$ref'] || (propertyVal['items'] && propertyVal['items']['$ref'])) {
            let refPath = propertyVal['$ref']
            let withItems = false;
            if (propertyVal['items'] && propertyVal['items']['$ref']) {
                refPath = propertyVal['items']['$ref'];
                withItems = true;
                delete propertyVal['items']['$ref'];
            }
            let ref = refPath.slice(21);
            withItems ? propertyVal['items'][ref] = schemas[ref] : propertyVal[ref] = schemas[ref];
            if (ref === propertyKey) {
                properties[propertyKey] = schemas[ref];
            }
            delete propertyVal['$ref'];
        } else if (propertyVal['items'] && propertyVal['items']['properties']) {
            extractItems(propertyVal['items']['properties']);
        } else {
            let refPath;
            if (propertyKey === 'requestBody') {
                refPath = propertyVal['content']['application/json']['schema']['$ref']
                let ref = refPath.slice(21);
                propertyVal[ref] = schemas[ref];
                delete propertyVal['content'];
            }
            if (propertyKey === 'responses') {
                let statusCode;
                if (propertyVal['200']) {
                    statusCode = 200
                } else if (propertyVal['201']) {
                    statusCode = 201
                }
                refPath = propertyVal[statusCode]['content']['application/json']['schema']['$ref']
                let ref = refPath.slice(21);
                propertyVal[statusCode]['content'][ref] = schemas[ref];
                delete propertyVal[statusCode]['content']['application/json'];
            }
        }
    }
}

const folder = fs.readdirSync('/home/alan/service-dependency/data/OpenApi');
for (let i = 0; i < folder.length; i++) {
    let currFile = folder[i]
    let extension = currFile.split('.').pop();
    if (extension === 'yml') {
        let response = readYamlFile.sync(`../data/OpenApi/${currFile}`);
        res = response;
        schemas = res['components']['schemas'];
        paths = res['paths'];
        let data = { services1: { name: '', link: '', version: '' }, services2: { name: '', link: '', version: '' }, contracts: [] };
        let openApi = path.parse(currFile).name;
        let currentService = res['link'].split('/')[4];
        data['services1']['version'] = res['info']['version'];
        data['services2']['version'] = res['info']['version'];
        data['services1']['name'] = currentService;
        data['services2']['name'] = openApi;
        data['services1']['link'] = res['link'];
        data['services2']['link'] = res['link'];
        conversion(res['components']['schemas'], 'schemas');
        conversion(res['paths'], 'paths');
        paths = Object.values(paths);
        for (let path of paths) {
            let contract = {
                'name': path.name,
                'version': res['info']['version'],
                'link': res['link'],
                'type': res['asyncapi'] ? `AMQP-${res['asyncapi']}` : `HTTP-${res['openapi']}`,
                'properties': {
                    [path.name]: path.get,
                }
            }
            data['contracts'].push(contract);
        }
        storage.push(data);
    }
}

let neo4jData = { nodes: storage };
let data2 = JSON.stringify(neo4jData, null, 2);

fs.writeFile('neo4jData2.json', data2, (err) => {
    if (err) throw err;
    console.log('Data written to file');
});


// var rs = [];
// for (let i = 0; i < f.length; i++) {
//     let r = {
//         services1: {},
//         services2: {},
//         contracts: []
//     };
//     for (let j = i + 1; j < f.length; j++) {
//         if (f[i]['currentService'] === f[j]['currentService']) continue;
//         f[i]['contracts'].forEach(e =>
//             f[j]['contracts'].forEach(a => {
//                 if (a.name === e.name) {
//                     if (a.action === 'publish') {
//                         r.services1.name = f[i]['currentService'];
//                         r.services2.name = f[j]['currentService'];
//                     } else {
//                         r.services1.name = f[j]['currentService'];
//                         r.services2.name = f[i]['currentService'];
//                     }
//                     r.services1.version = f[i]['version'];
//                     r.services2.version = f[j]['version'];
//                     r.services1.link = f[i]['link'];
//                     r.services2.link = f[j]['link'];
//                     r.contracts.push(a)
//                 }
//             })
//         )
//     }
//     r.contracts.length && rs.push(r);
// }
// rs = { nodes: rs };

// let data3 = JSON.stringify(rs, null, 2);
// fs.writeFile('rs.json', data3, (err) => {
//     if (err) throw err;
//     console.log('Data written to file');
// });

// exports.data = data;



