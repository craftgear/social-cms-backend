/*
  Copyright (C) 2013, Daishi Kato <daishi@axlight.com>
  All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
  "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
  HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

var _ = require('underscore');
var mongodb_manager = require('./mongodb_manager.js');
var authorization_manager = require('./authorization_manager.js');

function create(user_id, data, callback) {
  if (data._id) return callback('not allowed to specify _id');
  if (data.created_time) return callback('not allowed to specify created_time');
  if (!authorization_manager.hasPrivilege(user_id, 'CREATE_POST')) return callback('no CREATE_POST privilege'); //FIXME for each group

  //TODO check scope if it's valid to joined_groups

  data.created_time = new Date();
  mongodb_manager.createPrimaryKey('post', function(err, primary_key) {
    if (err) return callback(err);

    data._id = primary_key;
    mongodb_manager.getCollection('post', function(err, collection) {
      if (err) return callback(err);

      collection.insert(data, {
        w: 1
      }, function(err) {
        if (err) return callback(err);

        callback(null);
      });
    });
  });

  //TODO handle "destination" (for notification)
}

function fetch(user_id, post_id, callback) {
  mongodb_manager.getCollection('post', function(err, collection) {
    if (err) return callback(err);

    collection.findOne(post_id, function(err, data) {
      if (err) return callback(null, null); //not found

      if (!data.scope) return callback(null, data); //public scope
      if (_.contains(data.scope, {
        user_id: user_id
      })) return callback(null, data);
      var joined_groups = authorization_manager.getJoindGroups(user_id);
      if (_.some(joined_groups, function(group_id) {
        return _.contains(data.scope, {
          group_id: group_id
        });
      })) {
        callback(null, data);
        return;
      }

      callback(null, null); //not found
    });
  });
}

function fetchAll(user_id, query, sort, skip, limit, callback) {
  query = query || {};
  sort = sort || [
    ['created_at', 'desc']
  ];
  skip = skip || 0;
  limit = limit || 20;

  var joined_groups = authorization_manager.getJoindGroups(user_id);
  var criteria = [{
    'scope': {
      $exists: false
    }
  }, {
    'scope.user_id': user_id
  }];
  joined_groups.forEach(function(group_id) {
    criteria.push({
      'scope.group_id': group_id
    });
  });

  if (query.$or) {
    query.$or.push.appy(query.$or, criteria);
  } else {
    query.$or = criteria;
  }

  mongodb_manager.getCollection('post', function(err, collection) {
    if (err) return callback(err);

    collection.find(query, function(err, cursor) {
      if (err) return callback(err);

      callback(null, cursor.toArray());
    });
  });
}

function parseJSON(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null; //it's better to raise an error, though.
  }
}

function handleGet(req, res) {
  var current_user_id = authorization_manager.getCurrentUserId(req);
  var match = req.url.match(/^\/(\w)+$/);
  if (match) {
    var post_id = match[1];
    fetch(current_user_id, post_id, function(err, result) {
      if (err) {
        res.send(500, 'unable to fetch a post: ' + err);
      } else if (result) {
        res.json(result);
      } else {
        res.send(404);
      }
    });
  } else if (req.url === '') {
    fetchAll(current_user_id, parseJSON(req.query.query), parseJSON(req.query.sort), req.query.skip, req.query.limit, function(err, result) {
      if (err) {
        res.send(500, 'unable to list posts: ' + err);
      } else {
        res.json(result);
      }
    });
  } else {
    res.send(404);
  }
}

function handlePost(req, res) {
  var current_user_id = authorization_manager.getCurrentUserId(req);
  if (req.url === '') {
    create(current_user_id, req.body, function(err) {
      if (err) {
        res.send(500, 'unable to create a new post: ' + err);
      } else {
        res.json({
          status: 'ok'
        });
      }
    });
  } else {
    res.send(404);
  }
}

module.exports = function(options) {
  options = options; //XXX
  return function(req, res) {
    if (req.method === 'get') {
      handleGet(req, res);
    } else if (req.method === 'post') {
      handlePost(req, res);
    } else if (req.method === 'delete') {
      //TODO handleDelete(req, res);
    } else if (req.method === 'put') {
      //TODO handlePut(req, res);
    } else {
      res.send(400);
    }
  };
};