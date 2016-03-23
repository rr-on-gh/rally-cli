var rally = require('rally');
var _ = require('lodash');
var exec = require('child_process').exec;
var htmlToText = require('html-to-text');
var moment = require('moment');
var mb = require('moment-business');
var fs = require('fs');

var queryUtils = rally.util.query;
var refUtils = rally.util.ref;

var configFile = __dirname + '/config.json';
var config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
var restApi = rally({
    // API keys can be created/managed here:
    // https://rally1.rallydev.com/login/accounts/index.html#/keys
    apiKey : config.apiKey,
});
var currentItr = config.currentItr;
// Available in rally URL:
// https://rally1.rallydev.com/#/47117491705ud/iterationstatus
var project = config.project;
var user = config.user;
var rallyDefaultUrl = config.rallyDefaultUrl;
var uiLaunchCommand = config.uiLaunchCommand;

var hr = '-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------';

var getTasks = function(query, callback) {
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

var listIterationTasks = function(iteration) {
    console.log('Fetching iteration tasks...');
    // .and('FormattedID', '=', 'TA198752')
    getTasks(
            queryUtils.where('Owner.Name', '=', user).and('Iteration.Name', '=', iteration ? iteration : currentItr),
            function(error, result) {
                if (error) {
                    console.log(error);
                } else {
                    // console.log(result.Results);
                    var totalEstimate = 0;
                    var totalTodo = 0;
                    console.log(hr);
                    console.log('         | Est | Todo | Act |');
                    console.log(hr);
                    for ( var i in result.Results) {
                        var aResult = result.Results[i];
                        // console.log(aResult);
                        console.log('%s | %s | %s | %s | %s | %s | %s | %s', aResult.FormattedID, _.padEnd(
                                aResult.Estimate, 3), _.padEnd(aResult.ToDo, 4), _.padEnd(aResult.Actuals, 3),
                                colorizeOnState(_.padEnd(aResult.State, 12), aResult.State), _.padEnd(_.truncate(
                                        aResult.Name, {
                                            'length' : 70
                                        }), 70), aResult.WorkProduct.FormattedID, _.padEnd(_.truncate(
                                        aResult.WorkProduct.Name, {
                                            'length' : 70
                                        }), 70));
                        totalEstimate += aResult.Estimate;
                        totalTodo += aResult.ToDo;
                    }
                    console.log(hr);
                    // Fetch the iteration to check status
                    restApi
                            .get(
                                    {
                                        ref : result.Results[0].Iteration._ref,
                                        fetch : [ 'Name', 'Description', 'EndDate', 'StartDate' ],
                                        scope : {
                                            project : project
                                        }
                                    },
                                    function(error, result) {
                                        var s = moment(result.Object.StartDate, "YYYY-MM-DD'T'HH:mm:ss.SSSZ");
                                        var e = moment(result.Object.EndDate, "YYYY-MM-DD'T'HH:mm:ss.SSSZ");

                                        var c = completion(totalEstimate, totalTodo, s, e);
                                        console
                                                .log(
                                                        'Total    | %s | %s | (% Completion: %s) | [%s <--> %s | Total: %s | Remaining: %s | %Time Completed: %s%]',
                                                        _.padEnd(totalEstimate, 3), _.padEnd(totalTodo, 3),
                                                        c.remainingPctFormatted, s.format('ddd, MMM Do'), e
                                                                .format('ddd, MMM Do'), c.total, c.remaining,
                                                        c.remainingPct);
                                        console.log(hr);
                                    });

                }
            });
};

var completion = function(estimate, todo, s, e) {
    var completion = (Math.round((estimate - todo) / estimate * 100));
    var total = e.weekDays(s) + 1;
    var remaining = moment().isAfter(e) ? 0 : (e.weekDays(moment()) + 1);
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
    getTasks(queryUtils.where('FormattedID', '=', params.i), function(error, result) {
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
            } else {
                // console.log(result.Object);
                // listIterationTasks();
            }
        });
    });
};

var showTask = function(params) {
    getTasks(queryUtils.where('FormattedID', '=', params.i), function(error, result) {
        console.log(hr);
        console.log('%s - %s', result.Results[0].FormattedID, result.Results[0].Name);
        console.log(hr);
        var text = htmlToText.fromString(result.Results[0].Description, {
            wordwrap : hr.length
        });
        console.log(text);
        console.log(hr);
    });
};

var argv = require('minimist')(process.argv.slice(2));
switch (argv._[0]) {
case 'task':
case 't':
    if (argv.h || !argv.i) {
        console.log('usage: rly task -i ID [ -t todo_hrs ] [ -e estimate ]');
        console.log('\t rly task -i TA12345 -t 3 -e 5 ');
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
    var oldIt = config.currentItr;
    if (argv._.length > 1) {
        config.currentItr = argv._[1];
        console.log('Current Iteration changed from "%s" to "%s"', oldIt, config.currentItr);
        fs.writeFile(configFile, JSON.stringify(config, null, 2));
    } else {
        console.log('Current iteration is "%s"', config.currentItr);
        console.log('Change the iteration by running:\n\t rly it "New Iteration Name in double quotes"');
    }
    break;
default:
    listIterationTasks();
    break;
}