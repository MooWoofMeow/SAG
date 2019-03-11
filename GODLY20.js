'use strict';
// const Imap = require('imap');
const fs = require('fs');
const request = require('request');
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require("path");
const os = require("os");
const app = express();
const server = http.Server(app);
const io = socketio(server);
const settings = JSON.parse(fs.readFileSync('./GODLY/pCFG.json', 'utf-8'));
var usernamePasswordFile = settings.usernamePasswordFile || "username_password.txt";
var totalAccountToBeCreate = settings.totalAccountToBeCreate || 2000;
var createdAccounts = 0;
const port = process.argv[3] ? process.argv[3] : 80;
const mode = 'auto'; //['fast', 'auto'].includes(process.argv[2]) ? process.argv[2] : 'normal';
const autoConcurrency = 20; // process.argv[3] ? process.argv[3] : 1;
const logLevel = 2; // 0: ERROR (only errors) | 1: INFO (only finished actions) | 2: DEBUG (all)
// let imapChangeable = true;
let emailTryCount = [];
let queueSize;
let currentProxy;
let proxyByGid = [];
let proxyFails = [];
let proxySwitching = false;
let dumpCaptchas = ["ZZZZZL", "TTTZZT", "777Z77", "ZZZZZZ", "ZZZZZ7", "ZZZZZT", "LZZZZZ", "ZZZZZZZ", "8ava8a"];
let userAgentByProxy = {};
let userAgents = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/17.17134", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:64.0) Gecko/20100101 Firefox/64.0", "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; Touch; rv:11.0) like Gecko", "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36", "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36", "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:64.0) Gecko/20100101 Firefox/64.0", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 OPR/57.0.3098.116", "Mozilla/5.0 (Windows NT 6.2; WOW64) AppleWebKit/534.57.2 (KHTML, like Gecko) Version/5.1.7 Safari/534.57.2"];
// var imap;
let proxyList = [];
var sessionIds = [];
var sessionIdUrlMapper = {};
let countryCodes = "";
if (settings.proxy.getproxylist.countryCodes.length > 0) {
	for (var i = 0; i < settings.proxy.getproxylist.countryCodes.length; i++) {
		countryCodes = countryCodes + "&country[]=" + settings.proxy.getproxylist.countryCodes[i]
	}
} else {
	countryCodes = "&country[]=US"
}
// console.log(countryCodes);
if (settings.proxy.method != "api") {
	if (fs.existsSync(path.resolve(__dirname, `./GODLY/${settings.proxy.fileName}`))) {
		proxyList = fs.readFileSync(path.resolve(__dirname, `./GODLY/${settings.proxy.fileName}`)).toString().split(os.EOL);
		if (proxyList[0] == "") {
			proxyList = [];
		}
		if (proxyList.length == 0) {
			log(settings.proxy.fileName + " is empty, process terminating", 1);
			process.exit();
		}
	} else {
		log(settings.proxy.fileName + " does not exists, process terminating", 1);
		process.exit();
	}
}
const notifier = require('mail-notifier');
var imapConfig = {
	user: settings.email.inbox,
	password: settings.email.password,
	// host: settings.email.host,
	host: "sag.tools",
	port: settings.email.port,
	tls: settings.email.tls
};
var n;
if (settings.email.method == "imap") {
	n = notifier(imapConfig);
	n.on('connected', function() {
		log("Mail server connected", 2);
	}).on('end', function() {
		log("Email notifier session closed, reconnecting...", 2);
		if (createdAccounts >= totalAccountToBeCreate) {
			log("Process Completed createdAccounts: " + createdAccounts);
			process.exit();
		} else {
			n.start();
		}
	}).on('mail', function(mail) {
		parseAndCheckMail(mail);
	}).on('error', function(err) {
		log("Email notifier error: " + err, 0);
	}).start();
}
fs.writeFile('./GODLY/info.log', '', 'utf-8', (err) => {
	if (err) throw (err);
	start(totalAccountToBeCreate < autoConcurrency ? totalAccountToBeCreate : autoConcurrency);
});
app.use(express.static('files', {
	etag: true
}));
app.get('/', function(req, res) {
	res.sendFile(__dirname + '/public/index.html');
});

function start(size) {
	if (createdAccounts >= totalAccountToBeCreate) {
		log("Process Completed createdAccounts: " + createdAccounts);
		process.exit();
	}
	if (mode == 'auto') {
		// if (settings.email.method == "imap") {
		//     imapConnect();
		// }
		queueSize = size;
	} else {
		// server.listen(port, () => {
		//     log('running on port ' + port, 1);
		// });
	}
	if (settings.proxy.enabled) getProxy(false);
	else if (mode == 'auto') runQueue();
}

function runQueue() {
	if (createdAccounts >= totalAccountToBeCreate) {
		log("Process Completed createdAccounts: " + createdAccounts);
		process.exit();
	}
	if (queueSize != 0) {
		let size = queueSize > autoConcurrency ? autoConcurrency : queueSize;
		queueSize = 0;
		log('Starting tasks: ' + size, 1);
		for (let i = size; i > 0; i--) {
			setTimeout(() => {
				log('Started task #' + i, 1);
				startAccountCreation(0);
			}, 1000 * i);
		}
	}
}
var _webSession = {};

function startAccountCreation(socket) {
	if ((proxySwitching && !socket) || socket == 1) {
		queueSize++;
		return;
	}
	if (createdAccounts >= totalAccountToBeCreate) {
		log("Process Completed createdAccounts: " + createdAccounts);
		process.exit();
	}
	let proxy = currentProxy;
	let requestId = generateString(15);
	let cookieJar = request.jar();
	_webSession[requestId] = cookieJar;
	request.post('https://store.steampowered.com/join/refreshcaptcha/', {
		proxy: proxy,
		headers: {
			'User-Agent': userAgentByProxy[proxy] || userAgents[0]
		},
		jar: cookieJar
	}, (err, res, body) => {
		if (err) {
			log(err, 2);
			delete _webSession[requestId];
			switchProxy(proxy);
		} else if (res && body) {
			try {
				// console.log(body)
				body = JSON.parse(body);
			} catch (e) {
				log('Captcha loading (0): ' + e, 1);
				delete _webSession[requestId];
				// switchProxy(proxy);
				startAccountCreation(null);
				// if (!socket) {
				//     delete _webSession[requestId];
				//     startAccountCreation(null);
				// }
				// eventEmitter.emit('restart');
			}
			let gid = body.gid;
			request.get('https://store.steampowered.com/login/rendercaptcha?gid=' + gid, {
				encoding: null,
				proxy: proxy,
				headers: {
					'User-Agent': userAgentByProxy[proxy] || userAgents[0]
				},
				jar: cookieJar
			}, (err, res, body) => {
				if (err) {
					log(err, 2);
					delete _webSession[requestId];
					switchProxy(proxy);
				} else if (res && body) {
					if (res.statusCode == 200) {
						proxyByGid[gid] = proxy;
						let base64 = new Buffer.from(body).toString('base64');
						if (socket) {
							socket.emit('captcha', {
								btn: {
									send: true,
									captcha: true
								},
								gid: gid,
								base64: base64,
								message: {
									text: 'Captcha loaded',
									icon: 2
								}
							});
						} else {
							solveCaptcha(gid, base64, requestId);
						}
					} else {
						if (!socket) {
							delete _webSession[requestId];
							startAccountCreation(null);
						}
					}
				} else {
					log('Captcha loading error (2), retrying', 1);
					delete _webSession[requestId];
					startAccountCreation(socket);
					if (socket) {
						socket.emit('captcha', {
							load_new: true,
							btn: {
								captcha: false,
								send: false
							},
							message: {
								text: 'Captcha loding error, retrying',
								icon: 3
							}
						});
					}
				}
			});
		} else {
			log('Captcha loading error (1), retrying', 1);
			delete _webSession[requestId];
			startAccountCreation(socket);
			if (socket) {
				socket.emit('captcha', {
					load_new: true,
					btn: {
						captcha: false,
						send: false
					},
					message: {
						text: 'Captcha loding error, retrying',
						icon: 3
					}
				});
			}
		}
	});
}

function solveCaptcha(gid, base64, requestId) {
	let proxy = proxyByGid[gid];
	request.post('http://API.Captcha.Ninja/in.php', {
		form: {
			key: settings.captcha.apikey,
			method: 'base64',
			min_len: 6,
			max_len: 6,
			language: 2,
			body: base64,
			soft_id: 2355,
			json: 1
		}
	}, (err, res, body) => {
		if (err) {
			log('Captcha sending error (retying): ' + err, 0);
			// solveCaptcha(gid, base64, requestId);
			delete _webSession[requestId];
			switchProxy(proxy);
		} else {
			try {
				body = JSON.parse(body);
			} catch (e) {
				log('Captcha sending: ' + e, 1);
				setTimeout(() => {
					solveCaptcha(gid, base64, requestId);
				});
				return;
			}
			if (body.status == 1) {
				setTimeout(() => {
					check2captcha(gid, body.request, requestId)
				}, 1000);
			} else if (JSON.stringify(body) == 'ERROR_NO_SLOT_AVAILABLE') {
				log('2captcha busy, retrying');
				setTimeout(() => {
					solveCaptcha(gid, base64, requestId);
				});
			} else if (JSON.stringify(body) == 'ERROR_IMAGE_TYPE_NOT_SUPPORTED') {
				delete _webSession[requestId];
				startAccountCreation(socket);
			} else {
				handleError(JSON.stringify(body));
			}
		}
	});
}

function check2captcha(gid, id, requestId) {
	let proxy = proxyByGid[gid];
	let url = 'http://API.Captcha.Ninja/res.php?key=' + settings.captcha.apikey + '&action=get&id=' + id;
	request.get(url, (err, res, body) => {
		if (err) {
			log('Captcha checking error (retying): ' + err, 0);
			check2captcha(gid, id, requestId);
		} else if (res && body) {
			if (settings.captcha.version == "v1") {
				try {
					body = JSON.parse(body);
				} catch (e) {
					log('Captcha checking: ' + e, 1);
					delete _webSession[requestId];
					startAccountCreation(null);
					// eventEmitter.emit('restart');
				}
				if (body.status == 1) {
					let captcha = body.request;
					captcha = captcha.replace(/amp;/g, '');
					if (dumpCaptchas.includes(captcha)) {
						log('Dump Captcha:', captcha, 1);
						delete _webSession[requestId];
						startAccountCreation(null);
					} else {
						log('Captcha solved: ' + captcha, 2);
						verifyCaptcha(gid, captcha, null, id, requestId);
					}
				} else if (body.request == 'CAPCHA_NOT_READY') {
					log('Catpcha waiting...', 2)
					setTimeout(() => {
						check2captcha(gid, id, requestId)
					}, 5000);
				} else if (body.request == 'ERROR_CAPTCHA_UNSOLVABLE') {
					log('Captcha unsolvable', 2);
					delete _webSession[requestId];
					startAccountCreation(null);
				} else {
					// handleError('2captcha check: ' + id + ' >' + JSON.stringify(body));
					log('Captcha incorrect request', 2);
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			} else {
				if (body.includes("OK")) {
					let captcha = body.split("|")[1];
					if (dumpCaptchas.includes(captcha)) {
						log('Dump Captcha:', captcha, 1);
						delete _webSession[requestId];
						startAccountCreation(null);
					} else {
						log('Captcha solved: ' + captcha, 2);
						verifyCaptcha(gid, captcha, null, id, requestId);
					}
				} else if (body.includes("CAPCHA_NOT_READY")) {
					log('Catpcha waiting...', 2)
					setTimeout(() => {
						check2captcha(gid, id, requestId)
					}, 5000);
				} else if (body.includes("ERROR_CAPTCHA_UNSOLVABLE")) {
					log('Captcha unsolvable', 2);
					delete _webSession[requestId];
					startAccountCreation(null);
				} else {
					log('Captcha incorrect request', 2);
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			}
		} else {
			setTimeout(() => {
				check2captcha(gid, id, requestId)
			}, 5000);
		}
	});
}

function verifyCaptcha(gid, captcha, socket, id2captcha, requestId) {
	let proxy = proxyByGid[gid];
	let cookieJar = _webSession[requestId];
	request.post('https://store.steampowered.com/join/verifycaptcha/', {
		form: {
			captchagid: gid,
			captcha_text: captcha,
		},
		proxy: proxy,
		headers: {
			'User-Agent': userAgentByProxy[proxy] || userAgents[0]
		},
		jar: cookieJar
	}, (err, res, body) => {
		if (err) {
			log(err, 2);
			delete _webSession[requestId];
			switchProxy(proxy);
		} else if (res && body) {
			try {
				body = JSON.parse(body);
			} catch (e) {
				log('Captcha verification: ' + e, 1);
				delete _webSession[requestId];
				startAccountCreation(null);
			}
			if (body.bCaptchaMatches && body.bEmailAvail) {
				getEmailAddress(gid, captcha, socket, proxy, requestId);
				if (mode == 'normal') {
					socket.emit('captcha', {
						message: {
							text: 'Captcha verified, creating account',
							icon: 1
						}
					});
				}
				log('Captcha verified, creating account', 2);
			} else if (!body.bCaptchaMatches && body.bEmailAvail) {
				log('Captcha don\'t match', 2);
				if (mode == 'normal') {
					socket.emit('captcha', {
						load_new: true,
						btn: {
							captcha: true,
							send: true
						},
						message: {
							text: 'Captcha don\'t match',
							icon: 3
						}
					});
				} else if (!socket) {
					badCaptcha(id2captcha);
					log('Reporting bad captcha: ' + captcha + ' (id: ' + id2captcha + ')', 2);
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			}
		} else {
			log('Unexpected captcha verification error, retrying');
			setTimeout(() => {
				verifyCaptcha(gid, captcha, socket, id2captcha, requestId);
			}, 1000);
		}
	});
}

function getEmailAddress(gid, captcha, socket, proxy, requestId) {
	let username = generateString(10);
	if (settings.email.method == "imap") {
		let email = username + '@' + settings.email.domain;
		verifyEmail(email, username, gid, captcha, socket, proxy, requestId);
	} else {
		let email = username + '@' + settings.email.httpService.domain;
		verifyHttpEmail(email, username, gid, captcha, socket, proxy, requestId);
	}
}
///////////////////////////////////////////////////////////////////////////////////////////
function verifyHttpEmail(email, username, gid, captcha, socket, proxy, requestId) {
	if (mode == 'fast') {
		socket.emit('captcha', {
			load_new: true,
			btn: {
				captcha: true,
				send: false
			},
			message: {
				text: 'next one',
				icon: 2
			}
		});
	}
	let cookieJar = _webSession[requestId];
	request.post('https://store.steampowered.com/join/ajaxverifyemail', {
		form: {
			email: email,
			captchagid: gid,
			captcha_text: captcha
		},
		proxy: proxy,
		headers: {
			'User-Agent': userAgentByProxy[proxy] || userAgents[0]
		},
		jar: cookieJar
	}, (err, res, body) => {
		if (err) {
			log(err, 2);
			delete _webSession[requestId];
			switchProxy(proxy);
		} else if (res) {
			try {
				body = JSON.parse(body);
			} catch (e) {
				log('Email verification: ' + e, 1);
				if (!socket) {
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			}
			if (body.success == 1) {
				if (mode == 'normal') {
					socket.emit('captcha', {
						btn: {
							captcha: true,
							send: true
						},
						message: {
							text: 'Waiting for the email',
							icon: 1
						}
					});
				}
				log('Waiting for the email ' + email, 2);
				checkHttpEmailStatus(email, username, body.sessionid, socket, proxy, requestId);
			} else if (body.success == 84) {
				log('IP blocked (timeout)', 1);
				delete _webSession[requestId];
				switchProxy(proxy, false);
			} else {
				log(JSON.stringify(body));
				if (!socket) {
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			}
		} else {
			log('Unknown email verification error', 1);
			if (!socket) {
				delete _webSession[requestId];
				startAccountCreation(null);
			}
		}
	});
}

function findObjectByKey(array, key, value) {
	for (var i = 0; i < array.length; i++) {
		if (array[i][key] === value) {
			return array[i];
		}
	}
	return null;
}

function checkHttpEmailStatus(email, username, creationid, socket, proxy, requestId) {
	if (!emailTryCount[username]) emailTryCount[username] = 1;
	else emailTryCount[username]++;
	if (emailTryCount[username] > 60) {
		log(username + ' not verified, skipping', 2);
		delete _webSession[requestId];
		switchProxy(proxy);
	} else {
		request.get(`https://aio.email/api/v1/mail/list?recipient=${username}`, (err, res, body) => {
			if (err) {
				log(err, 2);
				if (!socket) {
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			} else {
				try {
					let mails = JSON.parse(body) || [];
					let mail = findObjectByKey(mails, 'recipient', email);
					if (mail) {
						let apiUrl = mail.storage.url;
						let apiPrefix = apiUrl.substr(0, apiUrl.indexOf('.')).split("//")[1];
						let key = mail.storage.key;
						request.get(`https://aio.email/api/v1/mail/getKey?mailKey=${apiPrefix}-${key}`, (err, res, _body) => {
							if (err) {
								log(err, 2);
								if (!socket) {
									delete _webSession[requestId];
									startAccountCreation(null);
								}
							} else {
								try {
									let mailBody = JSON.parse(_body);
									let plainText = mailBody["body-plain"];
									let urlRegex = new RegExp(`(https:\/\/store.steampowered.com\/account\/newaccountverification\\?stoken=[a-zA-Z0-9_-]*&creationid=[a-zA-Z0-9_-]*)`);
									let url = plainText.match(urlRegex);
									if (url.length > 0) {
										let cookieJar = _webSession[requestId];
										request.get(url[0], {
											proxy: proxy,
											headers: {
												'User-Agent': userAgentByProxy[proxy] || userAgents[0]
											},
											jar: cookieJar
										}, function(err, res, body) {
											if (err) {
												log(err, 2);
												delete _webSession[requestId];
												switchProxy(proxy);
											} else {
												// createAccount(username, creationid, socket, proxy);
												if (body.includes("Email Verified") || body.includes("This email has already been verified") || body.includes("Your Steam account has already successfully been created")) {
													createAccount(username, creationid, socket, proxy, requestId);
													if (mode == 'normal') {
														socket.emit('captcha', {
															message: {
																text: 'Email verified, creating account',
																icon: 1
															}
														});
													}
													log('Email verified, creating account ' + email, 2);
												} else {
													setTimeout(function() {
														checkHttpEmailStatus(email, username, creationid, socket, proxy, requestId);
													}, 300);
												}
											}
										});
									} else {
										if (!socket) {
											delete _webSession[requestId];
											startAccountCreation(null);
										}
									}
								} catch (err) {
									log(err, 2);
									if (!socket) {
										delete _webSession[requestId];
										startAccountCreation(null);
									}
								}
							}
						});
					} else {
						setTimeout(function() {
							checkHttpEmailStatus(email, username, creationid, socket, proxy, requestId);
						}, 300);
					}
				} catch (err) {
					log(err, 2);
					setTimeout(function() {
						checkHttpEmailStatus(email, username, creationid, socket, proxy, requestId);
					}, 300);
				}
			}
		});
	}
}
////////////////////////////////////////////////////////////////////////////////////////////
function verifyEmail(email, username, gid, captcha, socket, proxy, requestId) {
	if (mode == 'fast') {
		socket.emit('captcha', {
			load_new: true,
			btn: {
				captcha: true,
				send: false
			},
			message: {
				text: 'next one',
				icon: 2
			}
		});
	}
	let cookieJar = _webSession[requestId];
	request.post('https://store.steampowered.com/join/ajaxverifyemail', {
		form: {
			email: email,
			captchagid: gid,
			captcha_text: captcha
		},
		proxy: proxy,
		headers: {
			'User-Agent': userAgentByProxy[proxy] || userAgents[0]
		},
		jar: cookieJar
	}, (err, res, body) => {
		if (err) {
			log(err, 2);
			delete _webSession[requestId];
			switchProxy(proxy);
		} else if (res) {
			try {
				body = JSON.parse(body);
			} catch (e) {
				log('Email verification: ' + e, 1);
				if (!socket) {
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			}
			if (body.success == 1) {
				sessionIds.push(`${body.sessionid}`);
				if (mode == 'normal') {
					socket.emit('captcha', {
						btn: {
							captcha: true,
							send: true
						},
						message: {
							text: 'Waiting for the email',
							icon: 1
						}
					});
				}
				log('Waiting for the email ' + email, 2);
				checkEmailStatus(email, username, body.sessionid, socket, proxy, requestId);
			} else if (body.success == 84) {
				log('IP blocked (timeout)', 1);
				delete _webSession[requestId];
				switchProxy(proxy, false);
			} else {
				log(JSON.stringify(body));
				if (!socket) {
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			}
		} else {
			log('Unknown email verification error', 1);
			if (!socket) {
				delete _webSession[requestId];
				startAccountCreation(null);
			}
		}
	});
}

function checkEmailStatus(email, username, creationid, socket, proxy, requestId) {
	if (!emailTryCount[username]) emailTryCount[username] = 1;
	else emailTryCount[username]++;
	if (emailTryCount[username] > 80) {
		log(username + ' not verified, skipping', 2);
		delete _webSession[requestId];
		let _i = sessionIds.indexOf(creationid);
		if (_i > -1) {
			sessionIds.splice(_i, 1);
			delete sessionIdUrlMapper[creationid];
		}
		switchProxy(proxy);
	} else {
		let url = sessionIdUrlMapper[`${creationid}`];
		// console.log(22222222, url, creationid, sessionIdUrlMapper);
		if (url) {
			let cookieJar = _webSession[requestId];
			request.get(url, {
				proxy: proxy,
				headers: {
					'User-Agent': userAgentByProxy[proxy] || userAgents[0]
				},
				jar: cookieJar
			}, function(err, res, body) {
				if (err) {
					log(err, 2);
					delete _webSession[requestId];
					let _i = sessionIds.indexOf(creationid);
					if (_i > -1) {
						sessionIds.splice(_i, 1);
						delete sessionIdUrlMapper[creationid];
					}
					switchProxy(proxy);
				} else {
					if (body.includes("Email Verified") || body.includes("This email has already been verified") || body.includes("Your Steam account has already successfully been created")) {
						if (mode == 'normal') {
							socket.emit('captcha', {
								message: {
									text: 'Email verified, creating account',
									icon: 1
								}
							});
						}
						log('Email verified, creating account ' + email, 2);
						let _i = sessionIds.indexOf(creationid);
						if (_i > -1) {
							sessionIds.splice(_i, 1);
							delete sessionIdUrlMapper[creationid];
						}
						createAccount(username, creationid, socket, proxy, requestId);
					} else {
						setTimeout(function() {
							checkHttpEmailStatus(email, username, creationid, socket, proxy, requestId);
						}, 300);
					}
				}
			});
		} else {
			setTimeout(() => {
				// console.log(33333333, url, creationid, sessionIdUrlMapper);
				checkEmailStatus(email, username, creationid, socket, proxy, requestId);
			}, 1000);
		}
	}
}

function createAccount(username, creationid, socket, proxy, requestId) {
	let password = generateString(8, true);
	let cookieJar = _webSession[requestId];
	// console.log(777777777777, cookieJar, requestId);
	request.post('https://store.steampowered.com/join/createaccount/', {
		form: {
			accountname: username,
			password: password,
			creation_sessionid: creationid
		},
		proxy,
		headers: {
			'User-Agent': userAgentByProxy[proxy] || userAgents[0]
		},
		jar: cookieJar
	}, (err, res, body) => {
		if (err) {
			delete _webSession[requestId];
			switchProxy(proxy);
		} else if (res && body) {
			try {
				body = JSON.parse(body);
			} catch (e) {
				log(e);
				if (!socket) {
					delete _webSession[requestId];
					startAccountCreation(null);
				}
				return;
			}
			if (body.bSuccess) {
				request({
					method: 'POST',
					uri: 'https://store.steampowered.com/twofactor/manage_action',
					jar: cookieJar,
					simple: false,
					form: {
						action: 'actuallynone',
						sessionid: creationid
					},
					proxy,
					headers: {
						'User-Agent': userAgentByProxy[proxy] || userAgents[0]
					},
					followAllRedirects: true,
					followOriginalHttpMethod: true
				}, function(err, response, body) {
					if (err) {
						log('error while disable steam guard: ' + err, 0);
					} else {
						log('steam guard disabled', 2);
						// resolve(password);
						if (mode == 'normal') {
							socket.emit('captcha', {
								load_new: true,
								btn: {
									captcha: true,
									send: false
								},
								message: {
									text: 'Created ' + username,
									icon: 2
								}
							});
						}
						log('Created ' + username, 1);
						getId(username, password, requestId);
						if (mode == 'auto') {
							delete _webSession[requestId];
							startAccountCreation(null);
						}
					}
				});
			} else if (body.eresult == 14) {
				if (socket) {
					socket.emit('captcha', {
						btn: {
							captcha: false,
							send: false
						},
						message: {
							text: 'Username is not available',
							icon: 3
						}
					});
				}
				log('Username deleted because it is already registered: ' + username, 2);
				if (mode == 'auto') {
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			} else if (body.eresult == 16) {
				log('IP blocked, username reset: ' + username, 1);
				delete _webSession[requestId];
				switchProxy(proxy);
			} else {
				log('Creation failed: ' + JSON.stringify(body), 0);
				if (mode == 'auto') {
					delete _webSession[requestId];
					startAccountCreation(null);
				}
			}
		} else {
			log('Account creation failed', 1);
			if (!socket) {
				delete _webSession[requestId];
				startAccountCreation(null);
			}
		}
	});
}

function getId(username, password, requestId) {
	fs.appendFile(`./${usernamePasswordFile}`, `${username}:${password}${os.EOL}`, function(err) {
		if (err) {
			log('Username password saving error: ' + err, 0);
		} else {
			log('Added games to ' + username, 2);
			createdAccounts++;
			if (settings.account.create_login_batch) {
				fs.writeFileSync('./bat/' + username + '.bat', '"C:\\Program Files (x86)\\Steam\\Steam.exe" -login ' + username + ' ' + password);
				fs.appendFileSync('./bat/' + username + '.bat', '\nexit');
			}
			if (createdAccounts >= totalAccountToBeCreate) {
				setTimeout(function() {
					log("Process Completed createdAccounts: " + createdAccounts);
					process.exit();
				}, 5000);
			}
			if (queueSize <= 0 && (createdAccounts <= totalAccountToBeCreate)) {
				start(totalAccountToBeCreate - createdAccounts);
			}
		}
	});
}

function generateString(length = 10, need_num = false) {
	let str = "";
	let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < length; i++) {
		let x = Math.floor(Math.random() * chars.length);
		str += chars.charAt(x);
	}
	if ((need_num && !str.match(/\d/)) || !(str.match(/[A-Z]/) && str.match(/[a-z]/))) return generateString(length, need_num);
	else return str;
}

function parseAndCheckMail(mail) {
	var urls = mail.text.match(/https:\/\/store.steampowered.com\/account\/newaccountverification([^\n]*)/) || [];
	// if (url) request(url[0]);
	if (urls.length > 0) {
		let creationId = urls[0].substring(urls[0].lastIndexOf("=") + 1, urls[0].length);
		creationId = creationId.replace(/(\r\n|\n|\r)/gm, "");
		if (sessionIds.includes(creationId)) {
			log("New mail arrived for " + mail.to[0].address, 2);
			sessionIdUrlMapper[creationId] = urls[0];
			// console.log(1111111111, url[0], creationId, sessionIdUrlMapper);
		}
	}
}

function badCaptcha(id) {
	let url = 'http://API.Captcha.Ninja/res.php?key=' + settings.captcha.apikey + '&action=reportbad&id=' + id;
	request.get(url, (err, res, body) => {
		if (err) {
			log('Bad captcha report error: ' + err, 0);
		} else {
			if (settings.captcha.version == "v1") {
				try {
					body = JSON.parse(body);
				} catch (e) {
					log('Bad captcha report: ' + e, 1);
					return;
				}
				if (body.request == 'OK_REPORT_RECORDED') {
					log('Captcha reported', 2);
				} else {
					log('Bad captcha report error: ' + JSON.stringify(body), 0);
				}
			} else {
				if (body.includes("OK")) {
					log('Captcha reported', 2);
				} else {
					log('Bad captcha report error: ' + body, 0);
				}
			}
		}
	});
}

function switchProxy(proxy, force) {
	if (settings.proxy.enabled) {
		if (proxy == currentProxy) {
			if (proxyFails[proxy]) proxyFails[proxy]++;
			else proxyFails[proxy] = 1;
			if (proxyFails[proxy] > settings.proxy.threshold && !proxySwitching || force) {
				log('Proxy switch requested, switching now', 1);
				getProxy(true);
			} else if (proxySwitching) {
				log('Proxy switch requested, in progress', 2);
				queueSize++;
			} else {
				log('Proxy switch requested, ' + proxyFails[proxy] + '/' + settings.proxy.threshold + ' failed attempts', 2);
				startAccountCreation(null);
			}
		} else {
			log('Proxy switch requested, already switched', 2);
			startAccountCreation(null);
		}
	} else {
		log('Proxys not enabled');
	}
}

function getProxy(addQueue = false, force = false) {
	if (addQueue) queueSize++;
	if (!proxySwitching || force) {
		proxySwitching = true;
		if (settings.proxy.method == "api") {
			let url;
			if (settings.proxy.getproxylist.apikey != "") url = 'https://api.getproxylist.com/proxy?allowsPost=1&protocol[]=http&allowsHttps=1&allowsUserAgentHeader=1&apiKey=' + settings.proxy.getproxylist.apikey + countryCodes;
			else url = 'https://api.getproxylist.com/proxy?allowsPost=1&protocol[]=http&allowsHttps=1&allowsUserAgentHeader=1' + countryCodes;
			request.get(url, (err, res, body) => {
				if (err) {
					getProxy(false, force);
					return;
				}
				try {
					body = JSON.parse(body);
				} catch (e) {
					log('Proxy loading: ' + e);
					getProxy(false, force);
					return;
				}
				if (!body.ip) {
					handleError('proxy: ' + body.error);
				}
				let newProxy = 'http://' + body.ip + ':' + body.port;
				log('Testing new proxy: ' + newProxy, 2);
				request.post('https://store.steampowered.com', {
					proxy: newProxy,
					timeout: 3000
				}, (err, res, body) => {
					if (err) {
						log('Bad proxy', 2);
						getProxy(false, true);
					} else {
						if (mode == 'auto') runQueue();
						log('Got new working proxy: ' + newProxy, 2);
						currentProxy = newProxy;
						proxySwitching = false;
						userAgentByProxy[newProxy] = randomUserAgent();
					}
				});
			});
		} else {
			let newProxy = 'http://' + randomProxy();
			log('Testing new proxy: ' + newProxy, 2);
			request.post('https://store.steampowered.com', {
				proxy: newProxy,
				timeout: 3000
			}, (err, res, body) => {
				if (err) {
					log('Bad proxy', 2);
					getProxy(false, true);
				} else {
					if (mode == 'auto') runQueue();
					log('Got new working proxy: ' + newProxy, 2);
					currentProxy = newProxy;
					proxySwitching = false;
					userAgentByProxy[newProxy] = randomUserAgent();
				}
			});
		}
	}
}

function randomProxy() {
	let len = proxyList.length;
	let rand = proxyList[Math.floor(Math.random() * len)];
	return rand;
}

function randomUserAgent() {
	let len = userAgents.length;
	let rand = userAgents[Math.floor(Math.random() * len)];
	return rand;
}

function handleError(message) {
	let error = new Error(message);
	log(error.stack, 0, true);
}

function log(message, level, kill = false) {
	let date = new Date();
	let datevalues = [
		date.getFullYear(),
		date.getMonth() + 1,
		date.getDate()
	];
	let timevalues = [
		date.getHours(),
		date.getMinutes(),
		date.getSeconds(),
	]
	for (let i = 0; i < timevalues.length; i++) {
		if (timevalues[i].toString().length == 1) timevalues[i] = '0' + timevalues[i];
	}
	let timeString = datevalues.join('/') + ' ' + timevalues.join(':');
	message = timeString + ': ' + message;
	if (kill) console.error(message)
	else console.log(message);
	if (level <= logLevel) {
		message = message + '\n';
		fs.appendFile('./GODLY/info.log', message, 'utf-8', (err) => {
			if (err) throw (err);
			if (kill) process.exit();
		});
	}
}