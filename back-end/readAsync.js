const readYamlFile = require('read-yaml-file');
const writeYamlFile = require('write-yaml-file');
const fs = require('fs');
const path = require('path');
const lineByLine = require('n-readlines');
const database = require('./database/index.js');

var res = {};
var version;
var data = {};
var schemas = {};
var messages = {};
var topics = {};
var storage = [];
var lines = {};
const conversion = function (data, location) {
    for (let [dataKey, dataVal] of Object.entries(data)) {
        switch (location) {
            case 'schemas':
                if (dataVal['allOf']) {
                    for (let e of dataVal['allOf']) {
                        if (e['$ref']) {
                            let refPath = e['$ref']
                            let ref = refPath.slice(21);
                            e[ref] = schemas[ref];
                            delete e['$ref'];
                        } else {
                            conversion(e, 'schemas');
                        }
                    }
                } else {
                    properties = dataVal['properties'] || dataVal;
                }
                break;
            case 'messages':
                properties = dataVal['payload']['properties'] || dataVal['payload'];
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
        } else if (propertyVal['properties']) {
            extractItems(propertyVal['properties']);
        } else if (propertyKey === '$ref') {
            let refPath = propertyVal;
            let ref = refPath.slice(21);
            properties[ref] = schemas[ref];
            delete properties['$ref'];
        }
    }
}

const markServiceLine = function (currFile, lines) {
    let line;
    let lineNumber = 1;
    const liner = new lineByLine(`../data/AsyncApi/${currFile}`);
    while (line = liner.next()) {
        let content = line.toString('ascii').trim();
        if (content === 'X-Routing-Key:') {
            let nextContent = liner.next().toString('ascii').trim();
            lineNumber++;
            if (nextContent.slice(0, 7) === 'default') {
                nextContent = JSON.parse(nextContent.split(':').pop().replace(/'/g, '"'));
                if (!lines[currFile]) {
                    lines[currFile] = {};
                }
                lines[currFile][nextContent] = lineNumber - 1;
            }
        } else if (content === 'components:') {
            break;
        }
        lineNumber++;
    }
}

const folder = fs.readdirSync('/home/alan/service-dependency/data/AsyncApi');

for (let i = 0; i < folder.length; i++) {
    let currFile = folder[i]
    let extension = currFile.split('.').pop();
    if (extension === 'yml') {
        markServiceLine(currFile, lines);
        let response = readYamlFile.sync(`../data/AsyncApi/${currFile}`);
        res = response;
        schemas = res['components']['schemas'];
        data['title'] = res['info']['title'];
        data['contracts'] = [];
        topics = res['topics'];
        messages = res['components']['messages'];
        version = res['info']['version']
        console.log('filename:', currFile);
        conversion(res['components']['schemas'], 'schemas');
        conversion(res['components']['messages'], 'messages');
        for (const [key, value] of Object.entries(topics)) {
            let isSubscribe = false;
            let val = value['publish'];
            if (value['subscribe']) {
                val = value['subscribe'];
                isSubscribe = true;
            }
            if (!data[key]) {
                let ref = val['$ref'].substring(22);
                let task = ref.split('.').pop();
                let name;
                let taskInfo = '';

                if (val['headers']['allOf']) {
                    for (let e of val['headers']['allOf']) {
                        if (e['properties']) {
                            let title = e['properties']['X-Routing-Key']['default'];
                            // if (title.slice(0, 8) === 'Symbotic') {
                            //     name = title;
                            // }
                            name = title;
                        }
                    }
                }

                if (messages[ref] && messages[ref]['payload']['properties']) {
                    taskInfo = messages[ref]['payload']['properties'];
                } else if (messages[ref] && messages[ref]['payload'][task]) {
                    taskInfo = messages[ref]['payload'][task];
                }
                let link;
                if (lines[currFile][name]) {
                    link = res['link'] + '#L' + lines[currFile][name];
                } else {
                    link = res['link'];
                }
                let contract = {
                    'name': name,
                    'version': version,
                    'action': isSubscribe ? 'subscribe' : 'publish',
                    'link': link,
                    'type': res['asyncapi'] ? `AMQP- ${res['asyncapi']}` : `HTTP- ${res['openapi']}`,
                    'properties': {
                        [task]: taskInfo,
                    }
                }
                contract['properties'][task]['payload'] = messages[ref] && messages[ref]['payload']['type'];
                contract['properties'] = JSON.stringify(contract['properties']);
                data['contracts'].push(contract);
            }
        }
        let title = data.title;
        let contracts = data.contracts;
        let currentService = path.parse(currFile).name;
        storage.push({ currentService, title, version, link: res['link'], contracts });
    }
}

let ServicesWithContracts = JSON.stringify(storage, null, 2);

fs.writeFile('../data/ServicesWithContracts.json', ServicesWithContracts, (err) => {
    if (err) throw err;
    console.log('ServicesWithContracts written to file');
});


var Intersection = [];
var withIntersection = {};
for (let i = 0; i < storage.length; i++) {
    let r = {
        services1: {},
        services2: {},
        contracts: []
    };
    for (let j = i + 1; j < storage.length; j++) {
        storage[i]['contracts'].forEach(e =>
            storage[j]['contracts'].forEach(a => {
                if (a.name === e.name) {
                    if (a.action === 'publish') {
                        r.services1.name = storage[i]['currentService'];
                        r.services2.name = storage[j]['currentService'];
                        r.services1.link = storage[i]['link'];
                        r.services2.link = storage[j]['link'];
                    } else {
                        r.services1.name = storage[j]['currentService'];
                        r.services2.name = storage[i]['currentService'];
                        r.services1.link = storage[j]['link'];
                        r.services2.link = storage[i]['link'];
                    }
                    r.services1.version = storage[i]['version'];
                    r.services2.version = storage[j]['version'];
                    a['link'] = a['link'];
                    a['link2'] = e['link'];
                    r.contracts.push(a)
                    withIntersection[storage[i]['currentService']] = true
                    withIntersection[storage[j]['currentService']] = true;
                }
            })
        )
    }
    r.contracts.length && Intersection.push(r);
}
Intersection = { nodes: Intersection };

for (let k = 0; k < storage.length; k++) {
    if (!withIntersection[storage[k]['currentService']]) {
        Intersection['nodes'].push({
            services1: {
                name: storage[k]['currentService'],
                link: storage[k]['link'],
                version: storage[k]['version'],
            }
        })
    }
}

let neo4jData = JSON.stringify(Intersection, null, 2);
fs.writeFile('/var/lib/neo4j/import/neo4jData.json', neo4jData, (err) => {
    if (err) throw err;
    console.log('neo4jData written to file');
});

fs.writeFile('neo4jData.json', neo4jData, (err) => {
    if (err) throw err;
    console.log('neo4jData written to file');
});

const importToDatabase = async function () {
    await database.session.run('CALL apoc.load.json("file:///neo4jData.json") YIELD value RETURN value')
    await database.session.run(`CALL apoc.load.json("file:///neo4jData.json") YIELD value
    UNWIND value.nodes as n
    MERGE (a:service {name: n.services1.name, version: n.services1.version, link: n.services1.link})
    WITH * WHERE NOT n.services2.name IS NULL
    MERGE (b:service {name: n.services2.name, version: n.services2.version, link: n.services2.link})
    FOREACH (c IN n.contracts |
       MERGE (a)-[r:Contract {name:c.name, version:c.version, type:c.type, link:c.link}]->(b)
    )`)

}
// importToDatabase();



