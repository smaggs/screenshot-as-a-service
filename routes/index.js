var utils = require('../lib/utils');
var join = require('path').join;
var fs = require('fs');
var path = require('path');
var qs = require('querystring')
var request = require('request');
var validTypes = ['gif','png','jpg','pdf']

var express = require('express');

module.exports = function(app) {
  var rasterizerService = app.settings.rasterizerService;
  var fileCleanerService = app.settings.fileCleanerService;

  app.use(express.bodyParser())
  
  // routes
  app.post('/', function(req, res, next) {
    var imageType = req.param('imageType') || 'gif';
    if (validTypes.indexOf(imageType) == -1 ) {
        imageType = 'gif';
    }

    var html = req.body.html;
    var preview = 'preview_' + utils.md5(JSON.stringify(html)) + '.html';
    var previewPath = __dirname + '/../public/preview/' + preview;
    fs.writeFileSync(previewPath, html);
    fileCleanerService.addFile(previewPath);

    var url = utils.url('localhost:' + app.address().port + '/preview/' + preview);
    
    var options = {
      uri: 'http://localhost:' + rasterizerService.getPort() + '/',
      headers: { url: url }
    };
        
    ['width', 'height', 'clipRect', 'javascriptEnabled', 'loadImages', 'localToRemoteUrlAccessEnabled', 'userAgent', 'userName', 'password', 'imageType'].forEach(function(name) {
      if (req.param(name, false)) options.headers[name] = req.param(name);
    });
        
    var filename = 'screenshot_' + utils.md5(JSON.stringify(options)) + '.' + imageType;
    options.headers.filename = filename;

    var filePath = join(rasterizerService.getPath(), filename);

    var callbackUrl = req.param('callback', false) ? utils.url(req.param('callback')) : false;

    if (fs.existsSync(filePath)) {
      console.log('Request for %s - Found in cache', url);
      processImageUsingCache(filePath, res, callbackUrl, function(err) { if (err) next(err); });
      return;
    }
    console.log('POST request - Rasterizing it');
    processImageUsingRasterizer(options, filePath, res, callbackUrl, function(err) { if(err) next(err); });
  });
  
  app.get('/', function(req, res, next) {
    if (!req.param('url', false)) {
      return res.redirect('/usage.html');
    }

    var imageType = req.param('imageType') || 'gif';
    if (validTypes.indexOf(imageType) == -1 ) {
        imageType = 'gif';
    }

    var url = utils.url(req.param('url'));
    // required options
    var options = {
      uri: 'http://localhost:' + rasterizerService.getPort() + '/',
      headers: { url: url }
    };
    ['width', 'height', 'clipRect', 'javascriptEnabled', 'loadImages', 'localToRemoteUrlAccessEnabled', 'userAgent', 'userName', 'password', 'imageType'].forEach(function(name) {
      if (req.param(name, false)) options.headers[name] = req.param(name);
    });

    var filename = 'screenshot_' + utils.md5(url + JSON.stringify(options)) + '.' + imageType;
    options.headers.filename = filename;

    var filePath = join(rasterizerService.getPath(), filename);

    var callbackUrl = req.param('callback', false) ? utils.url(req.param('callback')) : false;

    if (fs.existsSync(filePath)) {
      console.log('Request for %s - Found in cache', url);
      processImageUsingCache(filePath, res, callbackUrl, function(err) { if (err) next(err); });
      return;
    }
    console.log('Request for %s - Rasterizing it', url);
    processImageUsingRasterizer(options, filePath, res, callbackUrl, function(err) { if(err) next(err); });
  });

  app.get('*', function(req, res, next) {
    // for backwards compatibility, try redirecting to the main route if the request looks like /www.google.com
    res.redirect('/?url=' + req.url.substring(1));
  });

  // bits of logic
  var processImageUsingCache = function(filePath, res, url, callback) {
    if (url) {
      // asynchronous
      res.send('Will post screenshot to ' + url + ' when processed');
      postImageToUrl(filePath, url, callback);
    } else {
      // synchronous
      sendImageInResponse(filePath, res, callback);
    }
  }

  var processImageUsingRasterizer = function(rasterizerOptions, filePath, res, url, callback) {
    if (url) {
      // asynchronous
      res.send('Will post screenshot to ' + url + ' when processed');
      callRasterizer(rasterizerOptions, function(error) {
        if (error) return callback(error);
        postImageToUrl(filePath, url, callback);
      });
    } else {
      // synchronous
      callRasterizer(rasterizerOptions, function(error) {
        if (error) return callback(error);
        sendImageInResponse(filePath, res, callback);
      });
    }
  }

  var callRasterizer = function(rasterizerOptions, callback) {
	if(rasterizerOptions.body) {
		console.log("body: " + rasterizerOptions.body);
	    request.post(rasterizerOptions, function(error, response, body) {
	        if (error || response.statusCode != 200) {
	          console.log('Error while requesting the rasterizer: %s %s', response.statusCode, error ? error.message : 'no message');
	          rasterizerService.restartService();
	          return callback(new Error(body));
	        }
	        callback(null);
	      });
	}
	else {
	    request.get(rasterizerOptions, function(error, response, body) {
	      if (error || response.statusCode != 200) {
	        console.log('Error while requesting the rasterizer: %s: %s', response.statusCode, error ? error.message : 'no message');
	        rasterizerService.restartService();
	        return callback(new Error(body));
	      }
	      callback(null);
	    });
    }
  }

  var postImageToUrl = function(imagePath, url, callback) {
    console.log('Streaming image to %s', url);
    var fileStream = fs.createReadStream(imagePath);
    fileStream.on('end', function() {
      fileCleanerService.addFile(imagePath);
    });
    fileStream.on('error', function(err){
      console.log('Error while reading file: %s', err.message);
      callback(err);
    });
    fileStream.pipe(request.post(url, function(err) {
      if (err) console.log('Error while streaming screenshot: %s', err);
      callback(err);
    }));
  }

  var sendImageInResponse = function(imagePath, res, callback) {
    console.log('Sending image in response');
    res.sendfile(imagePath, function(err) {
      fileCleanerService.addFile(imagePath);
      callback(err);
    });
  }

};
