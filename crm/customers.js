var express = require('express');
var mongoose = require('mongoose');
var Promise = require('bluebird');

var Customer = require('../../models/customer/customer');
var Order = require('../../models/customer/order');
var Quote = require('../../models/customer/quote');
var CatalogRequest = require('../../models/catalog/request');
var ContactRequest = require('../../models/customer/contact');
var Abandoned = require('../../models/customer/abandoned');
var Company = require('../../models/customer/company');

var es = require('../elasticsearch/elasticsearch');
var aggs = require('../mongodb/aggregates');
var orders = require('../customer/orders');
var contacts = require('../customer/contacts');
var quotes = require('../customer/quotes');
var customers = require('../customer/customers');

var ObjectId = require('mongoose').Types.ObjectId;
var PNF = require('google-libphonenumber').PhoneNumberFormat;

// Parse number with country code.


// Get Customers From ES
exports.getAll = function(filter, scroll){
  return new Promise(function(resolve, reject){
    var esQuery = {
      "query":{
          "match_all" : { }
     }
   }
   // If we have a Filter
   if(Object.keys(filter).length){
    // Elastic Query to Get Dashboard Stats
      var esQuery = {
          "query": {
             "match_all" : { }
          },
         "from": filter['from'],
         "size" : filter.size
        };
       if(filter.sortBy === 'name'){
         esQuery["sort"] =  {"name.raw": filter.sortOrder}
       }
    }

    var client = es.privateClient();
    // Hit ES
    if(typeof(scroll) === 'undefined' || scroll === ''){
      client.search({
          index: 'customers',
          type: 'customer',
          _source: true,
          scroll: '30s',
          body: esQuery
         })
         // Create Array of Product ID's to Fetch Data
         .then(function(resp){
           // Send Array to Lookup Product Data
           resolve(resp)
         })
          // Return Models and Appended Product Data
         .catch(function(err){
           resolve(err);
         })
      }
      // If we do have scroll data
    else {
      client.scroll({
        scrollId: scroll,
        scroll: '30s'
      })
      .then(function(resp){
        resolve(resp);
      })
      .catch(function(err){
        resolve(err);
      })
    }
  });
}

// Get Customer by ID
exports.getByID = function(id){
  return new Promise(function(resolve, reject){
    if(isNaN(id)){
      Customer.findOne({_id: id},function(err, res){
        if(err){ reject(err); }
        else{ resolve(res); }
      })
    }
    else{
      Customer.findOne({ID: parseInt(id)},function(err, res){
        if(err){ reject(err); }
        else{ resolve(res); }
      })
    }
  });
}

// Get Profile By Email
exports.getProfileByEmail = function(email){
  return new Promise(function(resolve, reject){
      Customer.findOne({email: email.toLowerCase()},function(err, res){
        if(err){ reject(err); }
        else{ resolve(res); }
      });
  });
}


// Update Customer
exports.update = function(dbData, newData){
  return new Promise(function(resolve, reject){
      Customer.update(dbData, function(err, res){
        if(err){ reject(res);}
        else{ resolve(res); }
      });
  });
}

// Create Customer
exports.import = function(data){
  return new Promise(function(resolve, reject){
    // Promise with properties
    Promise.props({
        addresses: JSON.parse(data.addresses),
        emails: JSON.parse(data.emails),
        name: JSON.parse(data.name),
        orders: JSON.parse(data.orders),
        phoneCalls: JSON.parse(data.phoneCalls),
        phoneNumbers: JSON.parse(data.phoneNumbers),
        quotes: JSON.parse(data.quotes),
        contacts: JSON.parse(data.contacts),
        created: data.created,
        lastContactDate: data.lastContactDate
    })
    // After initial promise returned
    .then(function(result) {
        var customer = new Customer(result);
        customer.save(function(err, res){
            if(err){ reject(res);}
            else{ resolve(res); }
        });
    })
    // On Error
    .catch(function(err){
      resolve(err);
    })
  });
}


// Save Customer Order
exports.saveOrder = function(orderData, customerIDs){
  return new Promise(function(resolve, reject){

  var orderLink = {};

  var order = new Order(orderData);
  // Save Order in mongoDB
  order.save(function(err, res){
    if(err){
        reject(err);}
    else{
       return res
      }
    })
  // Once Mongo Order is Saved
  .then(function(res){
    orderData.mongoID = res._id;
    // Create Order Link Data
    var orderLink = {
      linkID: res._id,
      domain: res.meta.domain,
      payment: {
        product: {
          raw: res.payment.charges.product.raw,
          dollarFormat: res.payment.charges.product.dollarFormat },
        total: {
          raw: res.payment.charges.total.raw,
          dollarFormat: res.payment.charges.total.dollarFormat }
      }
    }
    var multi = false;
    if(customerIDs.length > 1){
        multi = true;
    }
    // Update Customer Profile
    Customer.update(
      { _id : { $in : customerIDs }},
      {$push: {"orders": orderLink}},
      {safe: true, new : true, multi: multi},
      function(err, model) {
        if(err){ reject(err) }
        else{
          return model;
        }
      })
    })
    //
    .then(function(result){
      var client = es.privateClient();
      // Add to Elastic Search
      client.create({
        index: 'customers',
        type: 'order',
        id: orderData.mongoID.toString(),
        body: {
          sqlID: orderData.id,
          mongoID: orderData.mongoID,
          timestamp: orderData.timestamp,
          contents: orderData.contents,
          customers: customerIDs,
          payment: orderData.payment,
          shipping: orderData.shipping,
          billing: orderData.billing,
          meta: orderData.meta
        }
      }, function (error, response) {
        return response
      })
    })
    // Update ES Data
    .then(function(result){
      var client = es.privateClient();
      var body = [];
      for(x = 0; x < customerIDs.length; x++){
        body.push({ update: { _index: 'customers', _type: 'customer', _id: customerIDs[x] } })
        body.push({
           "script" : "orders+=order",
           "params" : {
              "order" : orderLink
           }
        })
      }
      client.bulk({
          body: body
      }, function (err, resp) {
        return resp;
      })
    })
    .then(function(result){
      resolve(orderData);
    })
    .catch(function(err){
      reject(err);
    })
  })
}

// Save Customer Order
exports.saveQuote = function(quoteData, customerIDs){
  return new Promise(function(resolve, reject){
  var quote = new Quote(quoteData);
  quote.save(function(err, res){
    if(err){
        reject(err);}
    else{
      quoteData.mongoID = res._id;
      // Create Order Link Data
      var quoteLink = {
        linkID: res._id,
        domain: res.meta.domain
      }
      var multi = false;
      if(customerIDs.length > 1){
          multi = true;
      }
      // Update Customer Profile
      Customer.update(
        { _id : { $in : customerIDs }},
        {$push: {"quotes": quoteLink}},
        {safe: true, new : true, multi: multi},
        function(err, model) {
          if(err){ reject(err) }
          else{
            resolve(model);
          }
        });
      }
    })
    // After we have saved quote in MongoDB
    .then(function(result){
      var client = es.privateClient();
      // Add to Elastic Search
      client.create({
        index: 'customers',
        type: 'quote',
        id: quoteData.mongoID.toString(),
        body: {
          sqlID: quoteData.id,
          mongoID: quoteData.mongoID,
          customerQuoteID: quoteData.customerQuoteID,
          timestamp: quoteData.timestamp,
          status: quoteData.status,
          contents: quoteData.contents,
          customers: customerIDs,
          shipping: quoteData.shipping,
          meta: quoteData.meta,
          customer: quoteData.customer
        }
      }, function (error, response) {
        return response;
      })
    })
    .then(function(result){
      return exports.updateCustomerES(customerIDs);
    })
    .then(function(result){
      resolve(quoteData);
    })
    .catch(function(err){
      reject(err);
    })
  })
}
// Update Elastic Search Customer Data
exports.updateCustomerES = function(customers){
  return new Promise(function(resolve, reject){
    Customer.find({ _id : { $in : customers }}, {}, function(err, res){
      var client = es.privateClient();
      var body = [];
      for(x = 0; x < res.length; x++){
        body.push({ update: { _index: 'customers', _type: 'customer', _id: res[x]._id } })
        body.push(res[x])
      }
      client.bulk({
          body: body
      }, function (err, resp) {
        resolve(resp);
      })
    })
  })
}
// Create Elastic Search Customer Record
exports.createCustomerES = function(customer){
  return new Promise(function(resolve, reject){
    var client = es.privateClient();
    // Add to Elastic Search
    client.create({
      index: 'customers',
      type: 'customer',
      id: customer._id.toString(),
      body: customer
    }, function (error, response) {
      resolve(response);
    })
  })
}

// Create Customer
exports.create = function(email, name, addresses, phoneNumbers, company){
  return new Promise(function(resolve, reject){
    // Create Customer Data Object
    var returned = {};
    var customer  = {
      name: name,
      company: company.toLowerCase(),
      email: email.toLowerCase(),
      lastContactDate: new Date(),
      created: new Date(),
      addresses: [],
      orders: [],
      phoneNumbers: []
    };
    // Add Phone Numbers
    for(i in phoneNumbers){
      var phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
      var phoneNumber = phoneUtil.parse(phoneNumbers[i].toString(), 'US');
      var phoneFormated = phoneUtil.format(phoneNumber, PNF.INTERNATIONAL);
      var phoneNumItem = {
        number: phoneFormated,
        raw: phoneNumber.values_,
        primary: 1
      }
      customer.phoneNumbers.push(phoneNumItem);
    }

    // Add Addresses
    for(i in addresses){
      var address = {
        city: addresses[i].city,
        country: addresses[i].country,
        zip: addresses[i].zip,
        line1: addresses[i].line1,
        line2: '',
        type: addresses[i].type
      }
      if(typeof(addresses[i].state) === 'undefined'){
        address.state = addresses[i].stateOther;
      }
      else{
        address.state = addresses[i].state;
      }
      address.full = address.line1+ ' ' + address.line2+ ' ' + address.city+ ' ' + address.state+' ' + address.zip + ' '+address.country;
      customer.addresses.push(address);
    }
    // Save Profile
    var profile = new Customer(customer);
    profile.save(function(err, res){
        if(err){
          reject(err);}
        else{
          returned.customer = res;
          customer._id = res._id;
          return res;
        }
    })
    // Add to Company
    .then(function(result){
      exports.addToCompany(customer._id, customer.company);
    })
    // Index in ES
    .then(function(result){
      exports.createCustomerES(returned.customer);
    })
    .then(function(result){
      return result;
    })
    .then(function(result){
      resolve(returned);
    })
  });
}



// Add Customer to Company
exports.addToCompany = function(customer, company){
  return new Promise(function(resolve, reject){
    var returned = {
      companyName: company
    };

    Company.findOne({'name': company.toLowerCase()}, {}, function(err,res){
      returned.company = res;
      return res;
    })
    // If profile Exists, Add
    .then(function(profile){
      if(profile === null || profile.length === 0){
        return exports.createCompany(company.toLowerCase(), customer);
      }
      else {
        var profile = profile[0]
        profile.employees.push(customer);
        returned.company = profile[0];
        // Update Company if Employee Not already linked
        return Company.update({'_id': profile._id},
          {$push: {"employees": customer}},
          {safe: true, new : true},
          function(err, res){
          return res;
        })
      }
    })
    .then(function(result){
      try{
        if(returned.company != null){
          var result = returned.company;
        }
        else{
          result = result.company;
        }

        var client = es.privateClient();

        // Add to Elastic Search
        client.create({
          index: 'customers',
          type: 'company',
          id: result._id.toString(),
          body: {
            _id: result._id,
            name: result.name,
            catalogRequests: result.catalogRequests,
            contacts: result.contacts,
            quotes: result.quotes,
            orders: result.orders,
            employees: result.employees
          }
        }, function (error, response) {
          return response
        });
      }
      catch(e){
        return true;
      }
    })
    // After we have company Profile
    .then(function(result){
      resolve(returned);
    })
    .catch(function(err){
      reject(err);
    })
  })
}

// Create Company
exports.createCompany = function(company, customer){
  return new Promise(function(resolve, reject){
    var returned = {};
    var companyData = {
      name: company,
      created: new Date(),
      employees: [customer.toString()]
    };
    var c = new Company(companyData);
    c.save(function(err, res){
      returned.company = res;
      return res
    })
    .then(function(result){
      var result = returned.company;
      var client = es.privateClient();
      // Add to Elastic Search
      client.create({
        index: 'customers',
        type: 'company',
        id: result._id.toString(),
        body: {
          name: result.name,
          created: result.created,
          employees: result.employees
        }
      }, function (error, response) {
        return response;
      })
    })
    .then(function(result){
      resolve(returned);
    })
  })
}

// Get Company By Name
exports.getCompanyByName = function(company){
  return new Promise(function(resolve, reject){
    Company.find({'name': company.toLowerCase()}, {}, function(err,res){
      returned.company = res;
      return res;
    })
  })
}

// Get All Companies
exports.getCompanies = function(filter){
  return new Promise(function(resolve, reject){
    var client = es.privateClient();
    var q = {
       query: {"match_all": {}},
       sort: [ {"name": {"order": "asc"} } ]
    }
    client.search({
     index: 'customers',
     type: 'company',
     scroll: '30s',
     _sourceInclude: "name,_id,employees",
     body: q
    }).then(function (resp) {
      resolve(resp.hits.hits);
    })
    .catch(function(err){
      resolve(err);
    })
  })
}


// Save Contact Request
exports.saveContactRequest = function(requestData, customerIDs){
  return new Promise(function(resolve, reject){
    var multi = false;
    if(customerIDs.length > 1){ multi = true; }
    var orderData = requestData.order;
    var contactData = {
      id: requestData.id,
      timestamp: requestData.timestamp,
      type: requestData.type,
      meta: requestData.meta,
      customer: requestData.customer,
      __v: requestData.__v
    }
    var contactRequest = new ContactRequest(contactData);
    // Save Catalog Request
    contactRequest.save(function(err, res){
      if(err){
          reject(err);}
      else{
        contactData = res;
        return res;
       }
   })
   // After we have saved catalog Request, Update Customer
   .then(function(result){
       // Create Link Data
       var link = { linkID: result._id, domain: result.meta.domain }
       // Update Customer Profile
       Customer.update(
         { _id : { $in : customerIDs }},
         {$push: {"contacts": link}},
         {safe: true, new : true, multi: multi},
         function(err, model){
           if(err){
             reject(err) }
           else{
             return model
           }
         }
      );
   })
   // Once request is saved in mongo, upload to ES
   .then(function(result){
     var result = contactData;
     var client = es.privateClient();
     // Add to Elastic Search
     client.create({
       index: 'customers',
       type: 'contactRequest',
       id: result._id.toString(),
       body: contactData
     }, function (error, response) {
       return response;
     })
   })
   .then(function(result){
    resolve(contactData);
   })

  })
}

// Get Newest Customers
exports.getNewest = function(count){
  return new Promise(function(resolve, reject){
      var esQuery = {
      "query":{
          "match_all" : { }
     },
     "sort": { "created": { "order": "desc" }}
   }
    var client = es.privateClient();
    client.search({
        index: 'customers',
        type: 'customer',
        _source: true,
        scroll: '30s',
        body: esQuery
       })
       .then(function(resp){
         resolve(resp)
       })
       .catch(function(err){
         resolve(err);
       })
  })
}

// Get Todays Customers
exports.today = function(){
  return new Promise(function(resolve, reject){
      var esQuery = {
          "query":{
            "range" : {
                "created" : {
                    "gte": "2015-10-25",
                    "time_zone": "+1:00"
                }
        }
         },
         "sort": { "created": { "order": "desc" }}
    }
    var client = es.privateClient();
    client.search({
        index: 'customers',
        type: 'customer',
        _source: true,
        scroll: '30s',
        body: esQuery
       })
       .then(function(resp){
         resolve(resp)
       })
       .catch(function(err){
         resolve(err);
       })
  })
}

exports.getDashboardStats = function(){
  return new Promise(function(resolve, reject){
    // Promise with properties
    Promise.props({
        todaysOrders: orders.today()
    })
    // Get Todays Orders, Quotes & Contacts
    .then(function(result){
      return result;
    })
    .then(function(result){
      resolve(result);
    })
    .catch(function(err){
      reject(err);
    })
  })
}

// Save Abandonded
exports.saveAbandoned = function(item){
  return new Promise(function(resolve, reject) {
    var data = new Abandoned(item);
    data.save(function(err, res){
      if(err){
          reject(err);}
      else{
        return res;
       }
     })
     .then(function(result){
       resolve(result);
     })
     // Index in ES
     .then(function(result){
       var client = es.privateClient();
       // Add to Elastic Search
       client.create({
         index: 'customers',
         type: 'abandoned',
         id: result._id.toString(),
         body: result
       }, function (error, response) {
         return response
       });
     })
     .catch(function(err){
       reject(err);
     })
  });
}



module.exports = exports;
