var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var cors = require('cors');
var database = require('../database/index.js');
const { node } = require('webpack');
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.get('/getAllNodes', async function (req, res) {
     try {
          let response = await database.session.run('MATCH (n) return n.name')
          let asyncApi = { AsyncAPI: [] };
          let openApi = { OpenAPI: [] };
          let result = [asyncApi, openApi];
          response.records.forEach((e) => {
               if (e._fields[0].includes('AsyncAPI') ) {
                    asyncApi.AsyncAPI.push(e._fields[0]);
               } else {
                    openApi.OpenAPI.push(e._fields[0]);
               }
          });
          res.status(200).send(result);
     } catch (err) {
          throw err;
     }
})

app.get('/getAllContracts', async function (req, res) {
     try {
          let response = await database.session.run('MATCH (a)-[r]->(b) RETURN r.name')
          let result = {};
          response.records.forEach((e) => {
               if (!result[e._fields[0]]) {
                    result[e._fields[0]] = true;
               }
          });
          res.status(200).send(Object.keys(result));
     } catch (err) {
          throw err;
     }
})

app.get('/getAllConnectedNodes', function (req, res) {
     database.session.run('MATCH (a)-[r]->(b) RETURN a.name, r, b.name ORDER BY r')
          .then(function (result) {
               const links = result.records.map((e) => {
                    return (
                         {
                              'source': e._fields[0],
                              'target': e._fields[2],
                         }
                    )
               });
               res.status(200).send(links);
          })
          .catch(function (err) {
               console.log(err);
               res.status(400).send(err);
          });
})

app.get('/getData', async function (req, res) {
     try {
          const data = await findData(true, false, null);
          res.status(200).send(data);
     } catch (err) {
          console.log(err);
     }
})

app.get('/getNodeInfo', async function (req, res) {
     let val = req.query.val;
     try {
          const data = await findData(false, false, val);
          res.status(200).send(data);
     } catch (err) {
          console.log(err);
     }
})

app.get('/getContractInfo', async function (req, res) {
     let val = req.query.val;
     try {
          const data = await findData(false, true, val);
          res.status(200).send(data);
     } catch (err) {
          console.log(err);
     }
})

app.post('/insertNode', function (req, res) {
     let label = req.body.label;
     let propertyKey = req.body.key;
     let propertyVal = req.body.val;
     database.session.run(`CREATE (a:${label} {${propertyKey}:"${propertyVal}"})`)
          .catch(function (err) {
               console.log(err);
               res.status(400).send(err);
          });
     res.status(201).end();
})

app.post('/connectNode', function (req, res) {
     let nodeA = req.body.nodeA;
     let nodeB = req.body.nodeB;
     let relationship = req.body.relationship;
     database.session.run(`
     MATCH (a:${nodeA.label}),(b:${nodeB.label})
     WHERE a.${nodeA.key} = "${nodeA.val}" AND b.${nodeB.key} = "${nodeB.val}"
     CREATE (a)-[r:${relationship}]->(b) return r
     `)
          .catch(function (err) {
               console.log(err);
               res.status(400).send(err);
          });
     res.status(201).end();
})

app.delete('/deleteNode', function (req, res) {
     let label = req.body.label;
     let key = req.body.key;
     let val = req.body.val;
     database.session.run(`MATCH (a:${label} {${key}: "${val}"}) DETACH DELETE a`)
          .catch(function (err) {
               console.log(err);
               res.status(400).send(err);
          });
     res.status(200).end();
})

const findData = async (allData, findByContract, val) => {
     var nodes;
     var relationShip;
     var query;
     if (findByContract) {
          query = `MATCH (a)-[r]->(b)
               WHERE r.name = "${val}"
               RETURN a.name, r, b.name ORDER BY r`;
     } else if (allData) {
          query = 'MATCH (a)-[r]->(b) RETURN a.name, r, b.name ORDER BY r';
     } else {
          query = `
               MATCH (a)-[r]->(b)
               WHERE a.name = "${val}" OR b.name = "${val}"
               RETURN a.name, a.version, a.link, r, b.name, b.version, b.link ORDER BY r
               `
     }
     const allConnectedNodes = await database.session.run(query)
     if (!allData) {
          const result = buildRelation(allConnectedNodes.records, allData, findByContract);
          let filter = result.filter;
          relationShip = result.links;
          nodes = buildNode(filter);
     } else {
          const response = buildRelation(allConnectedNodes.records, allData, findByContract);
          relationShip = response.relationShip;
          const nodeWithRelationship = response.withRelationship;
          const allNodes = await database.session.run('MATCH (n) return n')
          nodes = buildNode(allNodes.records, nodeWithRelationship);
     }
     const result = { info: nodes.concat(relationShip), infoLength: relationShip.length };
     return result;
}

const buildNode = (data, nodeWithRelationship) => {
     const result = data.map((e) => {
          const service = {
               'data': {
                    'id': e._fields ? e._fields[0].properties.name : e.name,
                    'label': e._fields ? e._fields[0].properties.name : e.name,
                    'link': e._fields ? e._fields[0].properties.link : e.link,
                    'version': e._fields ? e._fields[0].properties.version : e.version
               }
          }
          if (nodeWithRelationship) {
               if (!nodeWithRelationship[service['data']['id']]) {
                    service['data']['type'] = 'noConnection';
               }
          }
          return service
     });
     return result
}

const buildRelation = (data, allData, findByContract) => {
     var filter = {};
     var withRelationship = {};
     const links = data.map((e) => {
          if (!withRelationship[e._fields[0]]) {
               withRelationship[e._fields[0]] = true;
          }
          if (!withRelationship[e._fields[2]]) {
               withRelationship[e._fields[2]] = true;
          }
          if (!allData) {
               let name1 = e._fields[0];
               let version1 = findByContract ? e._fields[1]['properties']['version'] : e._fields[1];
               let link1 = findByContract ? e._fields[1]['properties']['link'] : e._fields[2];

               let name2 = findByContract ? e._fields[2] : e._fields[4];
               let version2 = findByContract ? version1 : e._fields[5];
               let link2 = findByContract ? e._fields[1]['properties']['link2'] : e._fields[6];

               if (!filter[name1]) {
                    const nodeInfo1 = { name: name1, version: version1, link: link1 };
                    filter[name1] = nodeInfo1;
               }
               if (!filter[name2]) {
                    const nodeInfo2 = { name: name2, version: version2, link: link2 };
                    filter[name2] = nodeInfo2;
               }
          }
          return (
               {
                    'data': {
                         'source': e._fields[0],
                         'link': allData || findByContract ? e._fields[1].properties.link : e._fields[3].properties.link,
                         'link2': allData || findByContract ? e._fields[1].properties.link2 : e._fields[3].properties.link2,
                         'label': allData || findByContract ? e._fields[1].properties.name : e._fields[3].properties.name,
                         'target': allData || findByContract ? e._fields[2] : e._fields[4],
                         'version': allData || findByContract ? e._fields[1].properties.version : e._fields[3].properties.version,
                         'type': allData || findByContract ? e._fields[1].properties.type : e._fields[3].properties.type
                    }
               }
          )
     });
     if (!allData) {
          const nodeInfo = [...Object.values(filter)];
          return { 'filter': nodeInfo, links };
     }
     return { relationShip: links, withRelationship };
}

const port = 4000;
app.listen(port, () => console.log('Listening on:', port));
module.exports = app;