var express = require('express');
var mongoose = require('mongoose');
var mysql = require('mysql');
var mf = require('../mysql/mysql');
var Promise = require('bluebird');
var getSlug = require('speakingurl');
var http = require('http');
var domains = require('../domain/domains');
var config = require('../../settings');
var es = require('../elasticsearch/elasticsearch');
var ObjectId = require('mongoose').Types.ObjectId;
var CrawlData = require('../../models/import-io/crawler_data');
var Crawlers = require('../../models/import-io/crawler');
var PriceWatcher = require('../../models/import-io/priceWatcher');
var PriceWatcherResult = require('../../models/import-io/priceWatcher_result');

// Get All Crawlers
exports.getAll = function(){
  return new Promise(function(resolve, reject){
    Crawlers.find(function(err, res){
      if(err){ reject(res);}
      else{ resolve(res); }
    });
  });
}

// Get Extractors
exports.getExtractors = function(){
  return new Promise(function(resolve, reject){
    Crawlers.find({'type': 'EXTRACTOR'}, function(err, res){
      if(err){ reject(res);}
      else{ resolve(res); }
    });
  });
}

// Get Crawlers
exports.getCrawlers = function(){
  return new Promise(function(resolve, reject){
    Crawlers.find({'type': 'CRAWLED_WEB'}, function(err, res){
      if(err){ reject(res);}
      else{ resolve(res); }
    });
  });
}

// Get Data Sets
exports.getDataSets = function(){
  return new Promise(function(resolve, reject) {
    Crawlers.find({'type': 'DATASET'}, function(err, res){
      if(err){ reject(res);}
      else{ resolve(res); }
    });
  });
}

// Get Crawler by ID
exports.getByID = function(id){
  return new Promise(function(resolve, reject){
    if(isNaN(id)){
      Crawlers.find({_id: id},function(err, res){
        if(err){ reject(err); }
        else{ resolve(res); }
      })
    }
    else{
      Crawlers.find({DOMAINID: parseInt(id)},function(err, res){
        if(err){ reject(err); }
        else{ resolve(res); }
      })
    }
  });
}

// Delete Crawler by ID
exports.deleteByID = function(id){
  return new Promise(function(resolve, reject){
    Crawlers.findOneAndRemove({_id: req.params.id }, function(err, res){
      if(err){ reject(err); }
      else{ resolve(res); }
    });
  });
};


// Update Crawler Data
exports.update = function(dbData, newData){
  return new Promise(function(resolve, reject){
      Crawlers.update(dbData, function(err, res){
        if(err){ reject(res);}
        else{ resolve(res); }
      });
  });
}

// Create Crawler
exports.create = function(crawler, data){
  return new Promise(function(resolve, reject){

      // If Dates are undefined, create timestamps
      Crawlers.save(function(err, res){
        if(err){ reject(res);}
        else{ resolve(res); }
      });
  });
}


// Crawl Page
exports.crawl = function(connectorID, url, auth){
  // If not passing Auth Info, use application account creds
  if(typeof(auth) === 'undefined'){
    var auth = {
      user: config.plugins['import-io'].user,
      key: config.plugins['import-io'].key
    }
  }
  var domain = domains.extractDomainFromURL(url);
  return new Promise(function(resolve, reject){
      var data = [];
      var myTimeout = 200;
        //The url we want is: 'www.random.org/integers/?num=1&min=1&max=10&col=1&base=10&format=plain&rnd=new'
        var options = {
          host: 'api.import.io',
          path: '/store/data/'+connectorID+'/_query?input/webpage/url='+url+'&_user='+auth.user+'&_apikey='+auth.key
        };
        callback = function(response) {
          var str = '';
          //another chunk of data has been recieved, so append it to `str`
          response.on('data', function (chunk) {
            str += chunk;
          });
          response.on('socket', function (socket) {
              socket.setTimeout(myTimeout);
              socket.on('timeout', function() {
                  req.abort();
              });
          });
          //the whole response has been recieved, so we just print it out here
          response.on('end', function () {
            var data = JSON.parse(str)
            exports.saveCrawl(data)
            .then(function(result){
                resolve(data);
            })
          });
        }
        http.request(options, callback).end();
    });
}

// Import all Import-IO Crawlers
exports.getImportAPICrawlers = function(auth){
  var url = '/store/connector/_search?q=*&_perpage=100&_sortDirection=DESC&_type=query_string&_default_operator=OR&_mine=false';

  // If not passing Auth Info, use application account creds
  if(typeof(auth) === 'undefined'){
    var auth = {
      user: config.plugins['import-io'].user,
      key: config.plugins['import-io'].key
    }
  }
  return new Promise(function(resolve, reject){
      var data = [];

        var options = {
          host: 'api.import.io',
          path: url+'&_user='+auth.user+'&_apikey='+auth.key
        };

        callback = function(response) {
          var str = '';
          //another chunk of data has been recieved, so append it to `str`
          response.on('data', function (chunk) {
            str += chunk;
          });
          //the whole response has been recieved, so we just print it out here
          response.on('end', function () {
            var data = JSON.parse(str)
            var results = [];
            for(x=0; x < data.hits.hits.length; x++){
              var resultItem = data.hits.hits[x].fields;
              resultItem._id = data.hits.hits[x]._id;
              resultItem._type = data.hits.hits[x]._type;
              results.push(resultItem);
              if(x === data.hits.hits.length - 1){
                exports.saveAllCrawlers(results)
                .then(function(result){
                    resolve(data);
                })
              }
            }

          });
        }
        http.request(options, callback).end();
    });
}

// Save All Crawlers
exports.saveAllCrawlers = function(data){
  return new Promise(function(resolve, reject){
    Crawlers.create(data, function (err, dataItems) {
        if (err){
            resolve(err);
        }
        else{
          resolve(dataItems);
        }
    });
  });
}

// Save Crawl Data
exports.saveCrawl = function(data){
    return new Promise(function(resolve, reject){
      var cd = new CrawlData(data);
      cd.save(function(err, res){
          if(err){ reject(err);}
          else{  resolve(res) }
      })
    });
}

// Parse Price Watch Form Submission
exports.parsePriceWatch = function(data){
  return new Promise(function(resolve, reject){
    //console.log(data);
    var watcher = {
      connectorGuid: data.crawlData.connectorGuid,
      connectorVersionGuid: data.crawlData.connectorVersionGuid,
      pageUrl: data.crawlData.pageUrl,
      product: data.product,
      type: "price",
      interval: data.interval,
      competitor: domains.extractDomainFromURL(data.crawlData.pageUrl),
      models: []
    }
    for(x=0;x < data.crawlData.models.length; x++){
      if(data.crawlData.models[x].selected !== null){
        var modelData = {

          pageModel: data.crawlData.models[x].name,
          linkedModel: data.models[data.crawlData.models[x].selected]._id
        }
        watcher.models.push(modelData);
      }
      if(x === data.crawlData.models.length - 1){
        resolve(watcher);
      }
    }
  });
}

// Save Price Watch
exports.savePriceWatch = function(data){
  return new Promise(function(resolve, reject){
    var watcher = new PriceWatcher(data);
    watcher.save(function(err, res){
        if(err){ reject(err);}
        else{  resolve(res) }
    })
  });
}

exports.savePriceResults = function(data, watcher){
  return new Promise(function(resolve, reject){
    var crawlDataResults = {
      watcher: watcher._id,
      domain: domains.extractDomainFromURL(data.crawlData.pageUrl),
      runDate: new Date(),
      results: []
    };
    //console.log(watcher);
    var originalResults = {
      results: data.crawlData.results,
      cookies: data.crawlData.cookies,
      connectorVersionGuid: data.crawlData.connectorVersionGuid,
      connectorGuid: data.crawlData.connectorGuid,
      pageUrl: data.crawlData.pageUrl,
      outputProperties: data.crawlData.outputProperties
    }
    //console.log(originalResults);
    var parsedModels = {};
    for(x=0; x < watcher.models.length; x++){
      parsedModels[watcher.models[x].pageModel] = {
        linkedModel: watcher.models[x].linkedModel
      }
    }
    //console.log(parsedModels);
    var models = [];
    // Loop Each Result Item
    for(m=0; m < data.crawlData.results.length; m++){
      var model = {}
      // Loop Properties
      for(x=0; x< data.crawlData.outputProperties.length; x++){
        var dataItem = {
          name: data.crawlData.outputProperties[x].name,
          type: data.crawlData.outputProperties[x].type
        }
        if(typeof(data.crawlData.results[m][dataItem.name]) != 'undefined' ){
            // Set Name
            if(data.crawlData.outputProperties[x].name === 'model'){
              model.pageModel = data.crawlData.results[m][dataItem.name];
              // If we have model in watcher IDs
              if(typeof(parsedModels[model.pageModel]) != "undefined"){
                model.model = parsedModels[model.pageModel].linkedModel;
              }
            }
            // Set Price
            if(dataItem.type === 'CURRENCY'){
              model.price = {
                raw: data.crawlData.results[m][dataItem.name],
                dollarFormat: data.crawlData.results[m][dataItem.name+'/_source'],
                currency: data.crawlData.results[m][dataItem.name+'/_currency']
              }
            }
            if(dataItem.type === 'STRING'){
              dataItem.value = data.crawlData.results[m][dataItem.name];
            }
        }
      }
      crawlDataResults.results.push(model);
    }
    // Now Save Result
    var watchResult = new PriceWatcherResult(crawlDataResults);
    watchResult.save(function(err, res){
        if(err){ reject(err);}
        else{
          // On Save Update Watcher Record with Latest ID, runDate and next scheduled Run Date
          var query = { _id: res.watcher };
          var update = {
            lastRun: res.runDate,
            latestResult: res._id
          }
          update.nextRun = new Date(update.lastRun.getTime() + watcher.interval*24*60*60*1000);
          PriceWatcher.findOneAndUpdate(query, update, {}, function(err, res){
             resolve(res)
          })
         }
    })
  });
}

// Get Crawlers For Domain
exports.getDomainCrawlers = function(domain, filter){
  return new Promise(function(resolve, reject){
    var client = es.client();
    var www = domain.substring(3, 0)
    if(www === 'www'){
      var reversedDomainName = 'com'+domain.substring(3);
      var reversedDomainName = reversedDomainName.substring(0, reversedDomainName.length - 3)+'www.';
    }
    else{
      var reversedDomainName = 'com.'+domain.substring(0, domain.length - 4)+'.';
    }
    Crawlers.find({'reversedDomain': reversedDomainName}, function(err, res){
      if(err){ reject(res);}
      else{
        return res;
      }
    })
    .then(function(result){
      resolve(result);
    })
    .catch(function(err){
      resolve(err);
    })

  });
}

// Get Crawlers for Product
exports.getProductWatchers = function(id){
  return new Promise(function(resolve, reject){
      var query = { product: new ObjectId(id) };
      PriceWatcher.find(query, function(err, res){
        resolve(res);
      })
  });
}

// Find Crawlers for Specific URL
exports.findCrawlersForURL = function(url){
  return new Promise(function(resolve, reject){

    var domain = domains.extractDomainFromURL(url);
    // Find Crawlers For This Domain
    exports.getDomainCrawlers(domain)
    .then(function(results){
      resolve(results);
    })
    .catch(function(err){
      reject(err);
    })
  })
}
