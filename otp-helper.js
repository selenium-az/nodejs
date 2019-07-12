var Connection = require('tedious').Connection;
var Request = require('tedious').Request;
var parseXml = require('xml2js').parseString;

var config = {
    authentication: {
        options: {
            userName: 'LCWPTAU',
            password: 'tau2019'
        },
        type: 'default'
    },
    server: 'ROMCS0579.user.alitalia.local',
    options: {
        database: 'DLCWPGS',
        encrypt: true
    }
};

function getOtp(from, mobile, email) {

    let otp = '';

    let sql =
        `SELECT TOP 1 DESOTPDAA 
        FROM LCWPTA.TOTPTSTDAA 
        WHERE ` + ((typeof mobile === "string") ? `DESMOB='${mobile}'` : `DESEML='${email}'`)
        + ((typeof from === "string") ? ` AND DATOTPCRE>='${from}'` : ``) + `
        ORDER BY DATOTPCRE DESC;`;

    return new Promise(function (resolve, reject) {
        var connection = new Connection(config);

        connection.on('connect',
            function (err) {
                if (err) {
                    reject(err.message);
                } else {
                    let request = new Request(sql, function (err) {
                        if (err) {
                            reject(err.message);
                        }
                    });

                    request.on('row', function (columns) {
                        parseXml(columns[0].value, function (err, result) {
                            if (err) {
                                reject(err.message);
                            } else {
                                otp = result.OtpData.Otp[0];
                            }
                        });
                    });

                    request.on('requestCompleted', function () {
                        connection.close();
                        resolve(otp);
                    });

                    connection.execSql(request);
                }
            });
    });
}

exports.getOtp = getOtp;