#! /usr/bin/env node
process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR ? process.env.NODE_CONFIG_DIR : __dirname + '/config/';

var rally = require('rally');
var _ = require('lodash');
var exec = require('child_process').exec;
var htmlToText = require('html-to-text');
var moment = require('moment');
var mb = require('moment-weekday-calc');
var fs = require('fs');
var config = require('config');
var async = require('async');

var queryUtils = rally.util.query;
var refUtils = rally.util.ref;
var restApi = rally({
    // API keys can be created/managed here:
    // https://rally1.rallydev.com/login/accounts/index.html#/keys
    apiKey : config.apiKey,
});
var currentItr = config.currentItr;
// Available in rally URL:
// https://rally1.rallydev.com/#/47117499999ud/iterationstatus
var user = config.user;
var uiLaunchCommand = config.uiLaunchCommand;
var configFile = process.env.NODE_CONFIG_DIR + 'default.json';
var hr = '-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------';
var totalTodo = 0;
var totalEstimate = 0;

var getTasks = function(query, project, callback) {
    restApi.query({
        type : 'task',
        start : 1,
        pageSize : 2,
        limit : 20,
        order : 'Rank',
        fetch : [ 'FormattedID', 'Name', 'Description', 'WorkProduct', 'Estimate', 'ToDo', 'State', 'Iteration',
                'Actuals' ],
        scope : {
            project : project,
            up : false,
            down : false
        },
        query : query,
        requestOptions : {}
    }, callback);
};

var listIterationTasks = function() {
    console.log('Fetching iteration tasks...');
    console.log(hr);
    console.log('         | Est | Todo | Act |');
    console.log(hr);

    async.eachSeries(config.projects, function(project, done) {
        getTasks(queryUtils.where('Owner.Name', '=', user).and('Iteration.Name', '=', project.currentItr), project.id,
            function(error, result) {
                if (error) {
                    console.log(error);
                } else {
                    if(!_.isEmpty(result.Results)) {
                        printTasks(result.Results, project, function(totalEstimate, totalTodo) {
                            project.iterationRef = result.Results[0].Iteration._ref;
                            //printTotals(result.Results[0].Iteration._ref, totalEstimate, totalTodo);
                            done();
                        });
                    } else {
                        console.log('No tasks for %s in iteration "%s" of project "%s"', user, project.currentItr, project.name);
                        done();
                    }
                }
            });
    },function() {
        console.log(hr);
        printTotals(config.projects[0]);
    });
};

var printTasks = function(tasks, project, callback) {
    for (var i in tasks) {
        var aResult = tasks[i];
        // console.log(aResult);
        console.log('%s | %s | %s | %s | %s | %s | %s | %s | %s', aResult.FormattedID, trimTo(aResult.Estimate, 3),
            trimTo(aResult.ToDo, 4), trimTo(aResult.Actuals, 3), colorizeOnState(trimTo(aResult.State, 12),
            aResult.State), trimTo(aResult.Name, 70), aResult.WorkProduct.FormattedID, trimTo(aResult.WorkProduct.Name, 30),
            trimTo(project.name, 40));
        totalEstimate += aResult.Estimate;
        totalTodo += aResult.ToDo;
    }
    if (callback)
        callback(totalEstimate, totalTodo);
}

var printTotals = function(project, callback) {
    var totalsTemplate = 'Total    | %s | %s | (% Completion: %s) | [%s <--> %s | Total: %s | Remaining: %s | %Time Completed: %s%]';
    restApi.get({
        ref : project.iterationRef,
        fetch : [ 'Name', 'Description', 'EndDate', 'StartDate' ],
        scope : {
            project : project.id
        }
    }, function(error, result) {
        if(result) {
            var s = moment(result.Object.StartDate, "YYYY-MM-DD'T'HH:mm:ss.SSSZ");
            var e = moment(result.Object.EndDate, "YYYY-MM-DD'T'HH:mm:ss.SSSZ");

            var c = completion(totalEstimate, totalTodo, s, e);
            console.log(totalsTemplate, _.padEnd(totalEstimate, 3), _.padEnd(totalTodo, 3), c.remainingPctFormatted, s
                .format('ddd, MMM Do'), e.format('ddd, MMM Do'), c.total, c.remaining, c.remainingPct);
            console.log(hr);
        }
        if (callback)
            callback();
    });
}

var completion = function(estimate, todo, s, e) {
    var completion = (Math.round((estimate - todo) / estimate * 100));
    var total = days(s, e);
    var remaining = moment().isAfter(e) ? 0 : days(moment(), e);
    var remainingPct = Math.round((total - remaining) / total * 100);
    // console.log(total + " " + remaining + " " + remainingPct);
    var c = {};
    c.total = total;
    c.remaining = remaining;
    c.remainingPct = remainingPct;
    c.remainingPctFormatted = completion >= remainingPct ? '\x1b[32m' + completion + '%\x1b[0m' : '\x1b[33m'
        + completion + '%\x1b[0m';
    return c;
};

var colorizeOnState = function(text, state) {
    if (state.indexOf('Completed') > -1) {
        return '\x1b[32m' + text + '\x1b[0m';
    } else if (state.indexOf('In-Progress') > -1) {
        return '\x1b[36m' + text + '\x1b[0m';
    } else if (state.indexOf('Defined') > -1) {
        return '\x1b[33m' + text + '\x1b[0m';
    } else {
        return text;
    }
};

var updateTask = function(params) {
    console.log("Updating %s", params.i);
    async.eachSeries(config.projects, function(project, done) {
        getTasks(queryUtils.where('FormattedID', '=', params.i), project.id, function(error, result) {
            if(result.Results[0]) {
                var data = {};

                if (params.t) {
                    data.ToDo = params.t;
                }
                if (params.e) {
                    data.Estimate = params.e;
                }
                if (params.t === 0) {
                    data.State = 'Completed';
                    data.Actuals = result.Results[0].Estimate;
                } else if (params.t === result.Results[0].Estimate) {
                    data.State = 'Defined';
                } else if (params.t > 0) {
                    data.State = 'In-Progress';
                }
                // If actuals explicitly provided, use that:
                if (params.a) {
                    data.Actuals = params.a;
                }
                restApi.update({
                    ref : result.Results[0]._ref,
                    data : data,
                    scope : {
                        project : project
                    },
                    requestOptions : {}
                }, function(error, result) {
                    if (error) {
                        console.log(error);
                    }
                });
            }
            done();
        });
    });
};

var showTask = function(params) {
    async.eachSeries(config.projects, function(project, done) {
        getTasks(queryUtils.where('FormattedID', '=', params.i), project.id, function(error, result) {
            if(result.Results[0]) {
                console.log(hr);
                console.log('%s - %s', result.Results[0].FormattedID, result.Results[0].Name);
                console.log(hr);
                var text = htmlToText.fromString(result.Results[0].Description, {
                    wordwrap : hr.length
                });
                console.log(text);
                console.log(hr);
            }
            done();
        });
    });
};

var holidays = function(params) {
    console.log('Configured holidays: ');
    _.forEach(config.holidays, function(v, i) {
        console.log(v);
    })
    console.log('Update %s to add or remove holidays', configFile);
}

var days = function(start, end) {
    var param = {};
    param.rangeStart = moment(start);
    param.rangeEnd = moment(end);
    param.weekdays = [ 1, 2, 3, 4, 5 ];
    param.exclusions = _.transform(config.holidays, function(result, holiday) {
        result.push(moment(holiday, 'DD MMM YYYY'));
    }, []);
    return moment().weekdayCalc(param) - 1;
}


var trimTo = function(s, l) {
    return _.padEnd(_.truncate(s, {
        'length' : l
    }), l);
}

var argv = require('minimist')(process.argv.slice(2));
switch (argv._[0]) {
case 'help':
case 'h':
    console.log('\x1b[33m' + 'Refer README.md of the project and update %s file for initial configuration\n' + '\x1b[0m', configFile);
    console.log('Usage: rly [ <command> ] [<args>]');
    console.log('\nMinimal CLI for rally\n');
    console.log('Available commands:');
    console.log('  it | iteration # View and change current iteration');
    console.log('  t  | task      # View and edit tasks');
    console.log('  o  | open      # Open rally in browser');
    console.log('  d  | holidays  # View the configured holidays');
    console.log();
    break;
case 'task':
case 't':
    if (argv.h || !argv.i) {
        console.log('Usage: rly task -i ID [ -t todo_hrs ] [ -e estimate ] [ -a actuals ]');
        console.log('\n View task details:\n  rly task -i TA12345');
        console.log('\n Change task todo, estimate and actuals:\n  rly task -i TA12345 -t 3 -e 5 -a 3');
        console.log();
        break;
    } else if (!_.isNil(argv.t) || !_.isNil(argv.e) || !_.isNil(argv.a)) {
        updateTask(argv);
        break;
    } else {
        showTask(argv);
    }
    break;
case 'open':
case 'o':
    exec(uiLaunchCommand);
    break;
case 'it':
case 'iteration':
    //console.log(argv);
    if (argv.p && argv.i) {
        _.forEach(config.projects, function(project, i) {
            if(argv.p === (i + 1)) {
                var oldIt = project.currentItr;
                project.currentItr = argv.i;
                console.log('Current Iteration of project %s from "%s" to "%s"', project.name, oldIt, project.currentItr);
                fs.writeFile(configFile, JSON.stringify(config, null, 2));
            }
        });
    } else {
        console.log(hr);
        console.log('%s | %s | %s', trimTo('ID', 2), trimTo('Project', 20), trimTo('Iteration', 20));
        console.log(hr);
        _.forEach(config.projects, function(project, i) {
            console.log('%d. | %s | %s', trimTo(i+1, 5), trimTo(project.name, 20), trimTo(project.currentItr, 20));
        });
        console.log(hr);
        console.log('Change the iteration for a project by running:\n\t rly it -p 2 -i "PI 2 - Iteration 3"');
    }
    break;
case 'd':
case 'holidays':
    holidays(argv);
    break;
default:
    listIterationTasks();
    break;
}
