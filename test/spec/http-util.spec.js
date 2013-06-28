/*jshint node:true */
/*global describe, beforeEach, it, expect, runs, waitsFor */
"use strict";

describe("HTTP util", function () {

    var httpStatusCodeDescrs = require("http").STATUS_CODES,
        nock = require("nock"),
        util = require("util"),
        http = require("http"),
        https = require("https"),
        fs = require("fs"),
        concat = require("concat-stream"),
        httpUtil = require(__dirname + "/../../http-util.js"),
        testFilePath = __dirname + "/../test.jpg";

    httpUtil.logLevel = 5;

    beforeEach(function() {
        this.addMatchers({
            toContainAllElementsOf: function(expected) {
                var expectedLength = expected.length,
                    actualLength = this.actual.length,
                    i;

                if (!this.isNot && actualLength < expectedLength) {
                    this.message = function () {
                        return "Expected actual buffer to have length of at least " + expectedLength;
                    };
                    return false;
                }

                this.message = function () {
                    return "Expected " + util.inspect(this.actual) + (this.isNot ? "not" : "") +
                        " to contain all elements of " + util.inspect(expected);
                };

                for (i = 0; i < expectedLength; ++i) {
                    if (expected[i] !== this.actual[i]) { return false; }
                }
                return true;
            }
        });
    });

    it("should be exported", function() {
        expect(httpUtil).toBeDefined();
    });

    it("should report its version", function() {
        expect(httpUtil.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    describe("/ bufferResponseContent", function () {

        it("should buffer response-content when content-length header is present", function () {
            var originHost, responseStatusCode, bufferedResponseContent, resourceContent = "Small Resource";

            runs(function () {
                originHost = nock("http://originhost")
                    .get("/resource/small")
                    .reply(200, resourceContent, { "content-length": resourceContent.length });

                http.request("http://originhost/resource/small", function (response) {

                    responseStatusCode = response.statusCode;

                    httpUtil.bufferResponseContent(response, {
                        onEnd: function (buffer, writtenContentLength) {
                            bufferedResponseContent = buffer.slice(0, writtenContentLength).toString();
                        }
                    });
                }).end();
            });

            waitsFor(function () {
                return bufferedResponseContent;
            }, "response-content to become available", 750);

            runs(function () {
                expect(responseStatusCode).toBe(200);
                expect(bufferedResponseContent).toEqual(resourceContent);
                originHost.done();
            });
        });

        it("should buffer response-content when content-length header is absent", function () {
            var originHost, responseStatusCode, bufferedResponseContent, resourceContent = "Small Resource";

            runs(function () {
                originHost = nock("http://originhost")
                    .get("/resource/small")
                    .reply(200, resourceContent);

                http.request("http://originhost/resource/small", function (response) {

                    responseStatusCode = response.statusCode;

                    httpUtil.bufferResponseContent(response, {
                        onEnd: function (buffer, writtenContentLength) {
                            bufferedResponseContent = buffer.slice(0, writtenContentLength).toString();
                        }
                    });
                }).end();
            });

            waitsFor(function () {
                return bufferedResponseContent;
            }, "response-content to become available", 750);

            runs(function () {
                expect(responseStatusCode).toBe(200);
                expect(bufferedResponseContent).toEqual(resourceContent);
                originHost.done();
            });
        });

        it("should buffer extended response-content when content-length header is absent", function () {
            var originHost,
                responseStatusCode,
                bufferedResponseContent,
                resourceContent;

            runs(function () {
                originHost = nock("http://originhost")
                    .get("/resource/small")
                    .replyWithFile(200, testFilePath);

                fs.readFile(testFilePath, function (error, buffer) { resourceContent = buffer; });

                http.request("http://originhost/resource/small", function (response) {

                    responseStatusCode = response.statusCode;

                    httpUtil.bufferResponseContent(response, {
                        onEnd: function (buffer, writtenContentLength) {
                            bufferedResponseContent = buffer.slice(0, writtenContentLength);
                        }
                    });
                }).end();

                waitsFor(function () {
                    return resourceContent && bufferedResponseContent;
                }, "response-content to become available", 750);

                runs(function () {
                    expect(responseStatusCode).toBe(200);
                    expect(bufferedResponseContent).toContainAllElementsOf(resourceContent);
                    originHost.done();
                });
            });
        });

    }); // describe("/ bufferResponseContent", ..

    describe("/ request", function() {

        var redirectStatusCodes = [300, 301, 302, 303, 307],
            request, responseStatusCode, responseContentStream, responseContent,

            // The path of requested resource will be the same in every request
            reqResourcePath = "/some/resource",

            // Define a number of 'transactions' (request - response pairs) to test
            transactions = [{
                req: { method: "GET" },
                rsp: { statusCode: 200, content: "Some Content" }
            }, {
                req: { method: "GET" },
                rsp: { statusCode: 404, content: "" }
            }, {
                req: { method: "POST" },
                rsp: { statusCode: 200, content: "Some Content" }
            }, {
                req: { method: "GET", body: ["please"] },
                rsp: { statusCode: 200, content: "Some Content" }
            }, {
                req: { method: "GET", body: ["pretty", "please"] },
                rsp: { statusCode: 200, content: "Some Content" }
            }, {
                req: { method: "GET", body: ["pretty", "please", "withcherries"] },
                rsp: { statusCode: 200, content: "Some Content" }
            }],
            writeRequestBody = function (requestBodyParts, request) {
                if (!requestBodyParts || !requestBodyParts.length) { return request.end(); }
                request.write(requestBodyParts.shift());
                global.setTimeout(function () { writeRequestBody(requestBodyParts, request); }, 100);
            };

        beforeEach(function () {
            request = null;
            responseStatusCode = null;
            responseContentStream = null;
            responseContent = null;
        });


        transactions.forEach(function (transaction) {

            describe("for transaction " + JSON.stringify(transaction), function () {

                ////
                ////
                it("should return response", function() {

                    var originHost;

                    runs(function () {
                        originHost = nock("http://originhost")
                            .intercept(reqResourcePath, transaction.req.method, transaction.req.body ? transaction.req.body.join("") : undefined)
                            .reply(transaction.rsp.statusCode, transaction.rsp.content);

                        responseContentStream = concat(function (buffer) {
                            responseContent = buffer;
                        });

                        request = httpUtil.request("http://originhost" + reqResourcePath, responseContentStream, {
                            method: transaction.req.method,
                            onResponse: function (statusCode) { responseStatusCode = statusCode; }
                        });

                        writeRequestBody(transaction.req.body, request);
                    });

                    waitsFor(function () {
                        return responseStatusCode && (transaction.rsp.content.length === 0 || responseContent);
                    }, "response-content to become available", 750);

                    runs(function () {
                        expect(responseStatusCode).toBe(transaction.rsp.statusCode);
                        expect(responseContent.toString()).toEqual(transaction.rsp.content);
                        originHost.done();
                    });
                });

                ////
                ////
                it("should return response with extended content", function() {

                    var originHost, resourceContent;

                    runs(function () {
                        originHost = nock("http://originhost")
                            .intercept(reqResourcePath, transaction.req.method, transaction.req.body ? transaction.req.body.join("") : undefined)
                            .replyWithFile(transaction.rsp.statusCode, testFilePath);

                        responseContentStream = concat(function (buffer) {
                            responseContent = buffer;
                        });

                        fs.readFile(testFilePath, function (error, buffer) { resourceContent = buffer; });

                        request = httpUtil.request("http://originhost" + reqResourcePath, responseContentStream, {
                            method: transaction.req.method,
                            onResponse: function (statusCode) { responseStatusCode = statusCode; }
                        });

                        writeRequestBody(transaction.req.body, request);
                    });

                    waitsFor(function () {
                        return responseStatusCode && responseContent && resourceContent;
                    }, "response-content to become available", 750);

                    runs(function () {
                        expect(responseStatusCode).toBe(transaction.rsp.statusCode);
                        expect(responseContent).toContainAllElementsOf(resourceContent);
                        originHost.done();
                    });
                });


                ////
                ////
                redirectStatusCodes.forEach(function (statusCode) {
                    it("should return response, following a single redirect (" + statusCode + ", " + httpStatusCodeDescrs[statusCode] + ")", function() {
                        var redirectingHost, originHost;

                        runs(function () {
                            redirectingHost = nock("http://redirectinghost")
                                .intercept(reqResourcePath, transaction.req.method)
                                .reply(statusCode, httpStatusCodeDescrs[statusCode], { Location: "http://originhost/some/resource"});

                            originHost = nock("http://originhost")
                                .intercept(reqResourcePath, transaction.req.method, transaction.req.body ? transaction.req.body.join("") : undefined)
                                .reply(transaction.rsp.statusCode, transaction.rsp.content);

                            responseContentStream = concat(function (buffer) {
                                responseContent = buffer;
                            });

                            request = httpUtil.request("http://redirectinghost" + reqResourcePath, responseContentStream, {
                                method: transaction.req.method,
                                followRedirects: true,
                                onResponse: function (statusCode) { responseStatusCode = statusCode; }
                            });

                            writeRequestBody(transaction.req.body, request);
                        });

                        waitsFor(function () {
                            return responseStatusCode && (transaction.rsp.content.length === 0 || responseContent);
                        }, "response-content to become available", 750);

                        runs(function () {
                            expect(responseStatusCode).toBe(transaction.rsp.statusCode);
                            expect(responseContent.toString()).toEqual(transaction.rsp.content);
                            redirectingHost.done();
                            originHost.done();
                        });
                    });

                    it("should return response with extended content, following a single redirect (" + statusCode + ", " + httpStatusCodeDescrs[statusCode] + ")", function() {
                        var redirectingHost, originHost, resourceContent;

                        runs(function () {
                            redirectingHost = nock("http://redirectinghost")
                                .intercept(reqResourcePath, transaction.req.method)
                                .reply(statusCode, httpStatusCodeDescrs[statusCode], { Location: "http://originhost/some/resource"});

                            originHost = nock("http://originhost")
                                .intercept(reqResourcePath, transaction.req.method, transaction.req.body ? transaction.req.body.join("") : undefined)
                                .replyWithFile(transaction.rsp.statusCode, testFilePath);

                            fs.readFile(testFilePath, function (error, buffer) { resourceContent = buffer; });

                            responseContentStream = concat(function (buffer) {
                                responseContent = buffer;
                            });

                            request = httpUtil.request("http://redirectinghost" + reqResourcePath, responseContentStream, {
                                protocol: "http",
                                hostname: "redirectinghost",
                                method: transaction.req.method,
                                path: reqResourcePath,
                                followRedirects: true,
                                onResponse: function (statusCode) { responseStatusCode = statusCode; }
                            });

                            writeRequestBody(transaction.req.body, request);
                        });

                        waitsFor(function () {
                            return responseStatusCode && resourceContent && responseContent;
                        }, "response-content to become available", 750);

                        runs(function () {
                            expect(responseStatusCode).toBe(transaction.rsp.statusCode);
                            expect(responseContent).toContainAllElementsOf(resourceContent);
                            redirectingHost.done();
                            originHost.done();
                        });
                    });
                });


                ////
                ////
                it("should return response following multiple redirects (" + redirectStatusCodes.join(", ") + ")", function() {
                    var redirectingHosts = [], originHost;

                    runs(function () {
                        var redirectLocation, i, l;
                        for (i = 0, l = redirectStatusCodes.length; i < l; ++i) {
                            redirectLocation = (i + 1) === l ? "http://originhost/some/resource" : "http://redirectinghost" + (i + 1) + "/some/resource";
                            redirectingHosts.push(nock("http://redirectinghost" + i)
                                .intercept(reqResourcePath, transaction.req.method)
                                .reply(redirectStatusCodes[i], httpStatusCodeDescrs[redirectStatusCodes[i]], { Location: redirectLocation }));
                        }

                        originHost = nock("http://originhost")
                            .intercept(reqResourcePath, transaction.req.method, transaction.req.body ? transaction.req.body.join("") : undefined)
                            .reply(transaction.rsp.statusCode, transaction.rsp.content);

                        responseContentStream = concat(function (buffer) {
                            responseContent = buffer;
                        });

                        request = httpUtil.request("http://redirectinghost0" + reqResourcePath, responseContentStream, {
                            method: transaction.req.method,
                            followRedirects: true,
                            onResponse: function (statusCode) { responseStatusCode = statusCode; }
                        });

                        writeRequestBody(transaction.req.body, request);
                    });

                    waitsFor(function () {
                        return responseStatusCode && (transaction.rsp.content.length === 0 || responseContent);
                    }, "response-content to become available", 750);

                    runs(function () {
                        expect(responseStatusCode).toBe(transaction.rsp.statusCode);
                        expect(responseContent.toString()).toEqual(transaction.rsp.content);
                        redirectingHosts.forEach(function (redirectingHost) { redirectingHost.done(); });
                        originHost.done();
                    });
                });


                ////
                ////
                it("should return response with extended content, following multiple redirects (" + redirectStatusCodes.join(", ") + ")", function() {
                    var redirectingHosts = [], originHost, resourceContent;

                    runs(function () {
                        var redirectLocation, i, l;
                        for (i = 0, l = redirectStatusCodes.length; i < l; ++i) {
                            redirectLocation = (i + 1) === l ? "http://originhost/some/resource" : "http://redirectinghost" + (i + 1) + "/some/resource";
                            redirectingHosts.push(nock("http://redirectinghost" + i)
                                .intercept(reqResourcePath, transaction.req.method)
                                .reply(redirectStatusCodes[i], httpStatusCodeDescrs[redirectStatusCodes[i]], { Location: redirectLocation }));
                        }

                        originHost = nock("http://originhost")
                            .intercept(reqResourcePath, transaction.req.method, transaction.req.body ? transaction.req.body.join("") : undefined)
                            .replyWithFile(transaction.rsp.statusCode, testFilePath);

                        fs.readFile(testFilePath, function (error, buffer) { resourceContent = buffer; });

                        responseContentStream = concat(function (buffer) {
                            responseContent = buffer;
                        });

                        request = httpUtil.request("http://redirectinghost0" + reqResourcePath, responseContentStream, {
                            method: transaction.req.method,
                            followRedirects: true,
                            onResponse: function (statusCode) { responseStatusCode = statusCode; }
                        });

                        writeRequestBody(transaction.req.body, request);
                    });

                    waitsFor(function () {
                        return responseStatusCode && resourceContent && responseContent;
                    }, "response-content to become available", 750);

                    runs(function () {
                        expect(responseStatusCode).toBe(transaction.rsp.statusCode);
                        expect(responseContent).toContainAllElementsOf(resourceContent);
                        redirectingHosts.forEach(function (redirectingHost) { redirectingHost.done(); });
                        originHost.done();
                    });
                });

            }); // describe("when origin-host response is ...
        }); // replies.forEach
    }); // describe("/ request", ..
}); // describe("HTTP util", ...