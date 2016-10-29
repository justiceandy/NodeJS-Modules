var express = require('express');
var Promise = require('bluebird');
var google = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var settings =  require('../../settings');
var plus = google.plus('v1');
var User = require('../../models/user/user');
var gContact = require('../../models/google/gContact');
var users =  require('../user/users');
var https = require('https');
var AdWords = require('googleads-node-lib');

var oauth2Client = new OAuth2(process.env.google_client_id, process.env.google_client_secret, process.env.google_redirect_uris[0]);

// Get Auth URL
exports.getAuthURL = function(){
  return new Promise(function(resolve, reject){
    // Permission Scopes to Ask access for
    var scopes = [
      'https://www.googleapis.com/auth/plus.me',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/drive.scripts',
      'https://www.googleapis.com/auth/analytics',
      'https://www.googleapis.com/auth/analytics.manage.users',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.google.com/m8/feeds/',
      'https://www.googleapis.com/auth/urlshortener',
      'https://gdata.youtube.com',
      'https://mail.google.com/mail/feed/atom',
      'https://www.googleapis.com/auth/coordinate',
      'https://www.googleapis.com/auth/structuredcontent',
      'http://www.google.com/webmasters/tools/feeds/'
    ];
    var url = oauth2Client.generateAuthUrl({
      access_type: 'offline', // 'online' (default) or 'offline' (gets refresh_token)
      approval_prompt: "force",
      scope: scopes // If you only need one scope you can pass it as string
    });
    var returned = {
      url: url
    }
    resolve(returned);
  });
}

// Get Access Token
exports.getToken = function(authCode){
  return new Promise(function(resolve, reject){
      oauth2Client.getToken(authCode, function(err, tokens) {
      if(!err) {
        resolve(tokens);
      }
      else{
        reject(err);
      }
    });
  });
}

exports.getAccessToken = function(refreshToken){
  return new Promise(function(resolve, reject){
    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });
    oauth2Client.refreshAccessToken(function(err, tokens){
      resolve(tokens);
    })
  });
}

// Get Token Plus Profile
exports.getTokenPlusProfile = function(token){
  return new Promise(function(resolve, reject){
    oauth2Client.setCredentials({
      access_token: token.access_token,
      refresh_token: token.refresh_token
    });
    plus.people.get({ userId: 'me', auth: oauth2Client }, function(err, response) {
      // handle err and response
      if(!err){
        resolve(response);
      }
      else{
        reject(err);
      }
    });
  });
}

// Save Token Info
exports.saveTokenInfo = function(token, plusProfile){
  return new Promise(function(resolve, reject){
    users.getByEmail(plusProfile.emails[0].value)
    .then(function(result){
      User.update({'_id': result[0]._id}, {
        $set: {
          plusProfile: plusProfile,
          "apiTokens.google": token,
          verified: true
        }},
       function (err, res){
           resolve(res);
       })
    })
  });
}

// Get Root Drive Folders
exports.getDriveFiles = function(token){
  return new Promise(function(resolve, reject){
      var service = google.drive('v2');
      oauth2Client.setCredentials({
        access_token: token.access_token,
        refresh_token: token.refresh_token
      });
      service.children.list({
        auth: oauth2Client,
        folderId: 'root',
        q: "mimeType = 'application/vnd.google-apps.folder' and in root"
      },
      function(err, response) {
        if (err) {
          console.log('The API returned an error: ' + err);
          return;
        }
        else{
          resolve(response);
        }
      });
  })
}

// Get Contacts from Google Feed
exports.getContacts = function(token){
  return new Promise(function(resolve, reject){
    exports.getAccessToken(token)
    .then(function(result){
      var token = result.access_token;
      var options = {
        host: 'www.google.com',
        path: '/m8/feeds/contacts/default/full?alt=json&max-results=500&oauth_token='+token
      };
      callback = function(response) {
        var str = '';
        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function (chunk) {
          str += chunk;
        });
        //the whole response has been recieved, so we just print it out here
        response.on('end', function () {
          resolve(JSON.parse(str));
        });
      }
      https.request(options, callback).end()
    })
  });
}

/*
  // Get Cloud printers
  exports.getPrinters = function(token){
    return new Promise(function(resolve, reject) {
      exports.getAccessToken(token)
      .then(function(result){
        var aToken = result.access_token;
        var cloud_print = new CloudPrint({
            service_provider: 'google',
            auth: {
                client_id: settings.plugins.google.client_id,
                client_secret: settings.plugins.google.client_secret,
                redirect_uri: settings.plugins.google.redirect_uris[0],
                access_token: aToken,
                refresh_token: token
            }
        });
        var options = {};//extra options for filter
        cloud_print.getPrinters(options, function(err, response){
          resolve(cloud_print);
        });
      })
      .catch(function(err){
        reject(err);
      })
    });
  }
*/

// Get Mail Threads
exports.getMailThreads = function(token, q, page, labels){
  return new Promise(function(resolve, reject) {
    var service = google.gmail('v1');
    oauth2Client.setCredentials({
      refresh_token: token.refresh_token
    });
    var returned = {};
    var params = {};
    service.users.threads.list({
      auth: oauth2Client,
      userId: 'me',
      params: params
    },
    function(err, response) {
      if (err) {
        console.log('The API returned an error: ' + err);
        reject(err);
      }
      // We have Threads, lets get Thread Data for Each
      else{
        var threads = response.threads.map(function(thread){
          return exports.getSingleMailThread(token, thread.id);
        })
        Promise.all(threads).then(function(result) {
          var parsedThreads = result.map(function(thread){
            var parsed = {
              id: thread.id,
              messages: thread.messages
            };
            return parsed;
          })
          resolve(parsedThreads);
        });
      }
    })
  });
}

// Get Single Mail Thread
exports.getSingleMailThread = function(token, thread){
  return new Promise(function(resolve, reject) {
    var service = google.gmail('v1');
    oauth2Client.setCredentials({
      refresh_token: token.refresh_token
    });
    var params = {};
    service.users.threads.get({
      auth: oauth2Client,
      userId: 'me',
      id: thread
    },
    function(err, response) {
      if (err) {
        console.log('The API returned an error: ' + err);
        reject(err);
      }
      // We have Threads, lets get Thread Data for Each
      else{
        resolve(response);
      }
    });
  });
}

// Save Mail Thread
exports.importMailThread = function(thread){
  return new Promise(function(resolve, reject) {

  });
}

exports.getMailThreadArray = function(threads){
  return new Promise(function(resolve, reject) {

  });
}

// Get Short Url
exports.getShortUrls = function(token, q, page){
  return new Promise(function(resolve, reject) {
    var service = google.urlshortener('v1');
    oauth2Client.setCredentials({
      refresh_token: token.refresh_token
    });
    var params = {};
    service.url.list({
      auth: oauth2Client,
      userId: 'me',
      params: params
    },
    function(err, response) {
      if (err) {
        console.log('The API returned an error: ' + err);
        reject(err);
      }
      else{
        resolve(response);
      }
    });
  });
}

// Get Short URL Data
exports.getShortUrlData = function(url){
  return new Promise(function(resolve, reject) {
    var service = google.urlshortener('v1');
    oauth2Client.setCredentials({
      refresh_token: token.refresh_token
    });
    var params = {};
    service.users.messages.list({
      auth: oauth2Client,
      userId: 'me',
      params: params
    },
    function(err, response) {
      if (err) {
        console.log('The API returned an error: ' + err);
        reject(err);
      }
      else{
        resolve(response);
      }
    });
  });
}

// Get Calendars
exports.getCalendars = function(token){
  return new Promise(function(resolve, reject) {

  });
}

//


// Parse Printers
exports.parsePrinters = function(printers){
  return new Promise(function(resolve, reject) {
    console.log(printers);
    resolve(printers);
  });
}

// Import Printers
exports.importPrinters = function(printers){
  return new Promise(function(resolve, reject) {
    resolve(printers);
  });
}

// Parse Contact Feed Response
exports.parseContacts = function(contacts){
  var returned = {
    contacts: [],
    emails: []
  };
  return new Promise(function(resolve, reject){
    for(x=0; x < contacts.feed.entry.length; x++){
      returned.owner = contacts.feed.author[0].email['$t'];
      var thisContact = {
        id: contacts.feed.entry[x].id['$t'],
        owner: contacts.feed.author[0].email['$t'],
        updated: contacts.feed.entry[x].updated['$t'],
        name: contacts.feed.entry[x].title['$t'],
      }
      if(typeof(contacts.feed.entry[x]['gd$phoneNumber']) != 'undefined'){
        thisContact.phone = contacts.feed.entry[x]['gd$phoneNumber'][0]['$t'];
      }
      if(typeof(contacts.feed.entry[x]['gd$email']) != 'undefined'){
        thisContact.email = contacts.feed.entry[x]['gd$email'][0]['address'];
        returned.contacts.push(thisContact);
        returned.emails.push(thisContact.email);
      }
      if(x === contacts.feed.entry.length - 1){
        resolve(returned);
      }
    }
  });
}

// Imports Contacts into Application
exports.importContacts = function(contactData){
  return new Promise(function(resolve, reject){
    var returned = {};
    // Check What Contacts are Already Saved
    gContact.find(
      {'email': { $in: contactData.emails}, 'owner': contactData.owner } ,
      {},
      function(err, res){
      return res;
    })
    // Now that we have contacts that are saved, import others
    .then(function(result){
      return returned.existing = result;
    })
    // Parse Contacts that need to be imported
    .then(function(result){
      return returned.imported = contactData.contacts;
    })
    .then(function(result){
      gContact.collection.insert(returned.imported, {}, function(err, res){
        resolve(res);
      })
    })
  });
}

// Authenticate Adwords
exports.authenticateAdwords = function(token) {
  return new Promise(function(resolve, reject) {
    var Service = new AdWords.ManagedCustomerService({
      ADWORDS_CLIENT_ID: app.plugins.google['client_id'],
      ADWORDS_CLIENT_CUSTOMER_ID: app.plugins.google.adwords.customerID,
      ADWORDS_DEVELOPER_TOKEN: app.plugins.google.adwords.token,
      ADWORDS_REFRESH_TOKEN: token.refresh_token,
      ADWORDS_SECRET: app.plugins.google['client_secret'],
      ADWORDS_USER_AGENT: 'Node'
    });
    resolve(Service);
  });
}

module.exports = exports;
