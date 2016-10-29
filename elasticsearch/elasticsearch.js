var express = require('express');
var elasticsearch = require('elasticsearch');
var settings =  require('../../settings');
var logIndex =  require('../../../reqs/es/mappings/logs/logs.js');
var iisIndex =  require('../../../reqs/es/mappings/logs/iis.js');
var rp = require('request-promise');
var cron = require('node-schedule');

// Set Daily Rule for 11PM
var dailyRule = new cron.RecurrenceRule();
  dailyRule.dayOfWeek = [0,1,2,3,4,5,6];
  dailyRule.hour = 11;
  dailyRule.minute = 00;

var dailyIndexes = {};
    dailyIndexes[settings.es.logs] = {mapping: logIndex, name:'events-'}

var client = new elasticsearch.Client({
    hosts: [
     settings.es.public
   ]
});

var privateClient = new elasticsearch.Client({
  hosts: [
   settings.es.private
 ]
});

// ping server
exports.ping = function(){
  return new Promise(function(resolve, reject){
    client.ping({
      requestTimeout: 3000
    }, function (error) {
      if (error) {
      //console.log(error);
      //console.trace('Public Elasticsearch cluster is down!');
      } else {
      //console.log('Public Elasticsearch cluster is running');
      }
    });
    privateClient.ping({
      requestTimeout: 3000
    }, function (error) {
      if (error) {
      //console.log(error);
      //console.trace('Private Elasticsearch cluster is down!');
      } else {
      //console.log('Private Elasticsearch cluster is running');
      }
    });
  });
}

// Return Connected Client
exports.client = function(){
  return client;
}

exports.privateClient = function(){
  return privateClient;
}


exports.getDailyIndexes = function(host, mapping, name){
  return new Promise(function(resolve, reject){
    resolve(dailyIndexes);
  });
}

// Create Daily Index
exports.createEventsIndex = function(){
  return new Promise(function(resolve, reject) {
    console.log('Creating Tomorrows Web Events ES Index');
    cron.scheduleJob(dailyRule, function(){
      return exports.createIndex('ES-HOST', new Date(new Date().getTime() + (24 * 60 * 60 * 1000)));
    })
    .then(function(result){
      resolve(result);
    })
    .catch(function(err){
      reject(err);
    })
  });
}

// Create Server Log Index
exports.createServerLogIndex = function(){
  return new Promise(function(resolve, reject) {
    console.log('Creating Tomorrows Server Log ES Index');
    cron.scheduleJob(dailyRule, function(){
      return exports.createIndex('ES-HOST', new Date(new Date().getTime() + (24 * 60 * 60 * 1000)));
    })
    .then(function(result){
      resolve(result);
    })
    .catch(function(err){
      reject(err);
    })
  });
}

exports.createDailyIndexes = function(){
  return new Promise(function(resolve, reject) {
    Promise.props({
      events: exports.createEventsIndex(),
      server: exports.createServerLogIndex()
    })
    .then(function(result) {
      resolve(result);
    });
  });
}

// Create ES Index
exports.createIndex = function(host, date){
  var day = date.getDate();
  var month = date.getMonth()+1; //January is 0!
  var year = date.getFullYear();
  if(day<10) {  day='0'+day }
  if(month<10) { month='0'+month }
  var indexString = year + '.'+month+'.'+day
  var indexName = host + '/'+dailyIndexes[host].name+indexString;
  return new Promise(function(resolve, reject){
      var options = {
        method: 'PUT',
        uri: indexName,
        body: dailyIndexes[host].mapping,
        json: true // Automatically stringifies the body to JSON
      };
      rp(options)
      .then(function (parsedBody) {
        resolve(parsedBody);
      })
      .catch(function (err) {
          // POST failed...
          reject(err);
      });
  });

}



module.exports = exports;
