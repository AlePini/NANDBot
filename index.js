var fs = require('fs');
var ini = require('ini');
var mysql = require('mysql');
var telegraf = require('telegraf');
var commandParts = require('telegraf-command-parts');
var AsyncLock = require('async-lock');

function getExtension(filename) {
  var i = filename.lastIndexOf('.');
  return (i < 0) ? '' : filename.substr(i);
}

function randDavoli(){
  var max = 100;
  return Math.floor(Math.random() * max);
}

function isBanned(id, callback){
    try{
        db.query("SELECT Banned FROM Users WHERE ID LIKE ?" , [id] ,(err, result) => {
            if (err) throw err;
            if (result.length)
                return callback(result[0].Banned);
        });
    } catch {
        console.log(err);
    }
}

function updateUser(id_user, username, first, last){

  try {
    lock.acquire("newUser", function(done) {
      db.query("SELECT * FROM Users WHERE ID LIKE ?", [id_user], (err, result) => {
        if (err) throw err;

        // ? New User ?
        if ( result.length == 0 ){
            db.query("INSERT INTO Users ( ID, username, first_name, last_name, Banned) VALUES ( ?, ?, ?, ?, 0 )", [ id_user, username, first, last ], (err, result) => {
              if (err)
                console.log(err);
              else
                console.log("[MYSQL] New User detected - " + first + " @" + username );
            });
        }

        // ? Username has changed ?
        else if ( result[0].username != username || result[0].first_name != first || result[0].last_name != last) {
            db.query("UPDATE Users SET username = ? , first_name = ?, last_name = ? WHERE ID LIKE ?", [username, first, last, id_user] , (err, result) => {
              if (err)
                console.log(err);
              else
                console.log("[MYSQL] Username of " + first + " - " + id_user + " changed to @" + username );
            });
        }

        done();

      });
      
    }, function(err, ret) {
      //Releasing NewUser
    }, {});

  } catch {
    console.log(err);
  }
}

function vote(id_user, id_message, id_message_from, date, vote){

  try {
    lock.acquire("newMessage", function(done) {
      db.query("INSERT INTO Messages ( ID, ID_User_From ) VALUES ( ?, ? )", [ id_message, id_message_from ], (err, result) => {
        if (!err)
          console.log("[MYSQL] New message on the db - " + id_message + " from " + id_message_from);
      });
      
      done();
      
    }, function(err, ret) {
      //Releasing NewMessage
    }, {});

    lock.acquire("newUpvote", function(done) {
      db.query("INSERT INTO Upvotes ( ID_User, ID_Message, Date, Vote ) VALUES ( ?, ?, ?, ? ) ", [ id_user, id_message, date, vote ], (err, result) => {
        if (!err)
          console.log("[MYSQL] New upvote on the db - " + id_message + " from " + id_user);
      });
      
      done();
      
    }, function(err, ret) {
      //Releasing NewUpvote
    }, {});

  } catch {
    console.log(err);
  }

}


// _ Setup Telegram Bot
var davoli = randDavoli();
var lock = new AsyncLock();
var conf = ini.decode(fs.readFileSync('./nand.ini', 'utf-8'));
var nand = new telegraf(conf.Nand.token);
nand.use(commandParts());

nand.command("/davoli", (ctx) => {

  console.log("[DAVOLI] Roulette : " + davoli + " for " + ctx.from.id + " in " + ctx.chat.id);

  if ( davoli <= 0 ){
    ctx.telegram.kickChatMember(ctx.message.chat.id, ctx.from.id);
    ctx.replyWithMarkdown("Ahah sfigato");
    console.log("[DAVOLI] LMAO Get Kicked");
    davoli = randDavoli();
  } else {
    ctx.replyWithMarkdown("Lucky 😉");
    davoli--;
  }

});

nand.command("/roll", (ctx) => {
  if(ctx.message.chat.id == conf.Nand.chatid){
    var dice = ctx.state.command.splitArgs[0].split('d');
    try {
      if (ctx.state.command.args == "rick")
          throw "[Free VBucks](https://www.youtube.com/watch?v=dQw4w9WgXcQ)";
      if(dice.length != 2 || ctx.state.command.splitArgs.length != 1)
          throw "Devi semplicemente scrivere '/roll 1d10', è così difficile?";
        else if(dice[0] < 1 || dice[1] < 1 )
          throw "Certo e ora ci mettiamo a fare i buchi nell'ozono con il trapano";
      else if(dice[0] > 100 || dice[1] > 100)
        throw "Fai meno lo spanizzo. Non sono il Marconi";

      // # Rolling Dice
      var results = [];
        dice[0] = parseInt(dice[0], 10);
        dice[1] = parseInt(dice[1], 10);

      if (isNaN(dice[1]) || isNaN(dice[0]))
        throw "No";

      for(var i = 0; i < dice[0]; i++)
        results.push(Math.floor(Math.random() * (dice[1]) + 1));
      var s = "*" + ctx.state.command.splitArgs[0] + "* = " + results.reduce((a, b) => a + b);
      ctx.replyWithMarkdown( s, { reply_to_message_id : ctx.message.message_id }); 
    } catch(e){
      ctx.replyWithMarkdown( e, { reply_to_message_id : ctx.message.message_id, disable_web_page_preview: true });
    }
  }
});

// 

nand.command("/rank", (ctx) => {
    try{
        db.query("SELECT m.ID_User_From as ID, SUM(u.Vote) as karma, users.username, users.first_name, users.last_name FROM Upvotes u LEFT JOIN Messages m ON m.ID = u.ID_Message LEFT JOIN Users users on users.ID = m.ID_User_From GROUP BY m.ID_User_From ORDER BY karma DESC LIMIT 25;", (err, result) => {
            if (err)
                throw err;
            var s = "";
            // Sync ForEach I WANT A REAL FUCKING RANK THANKS
            var ranking = function(i){

                if ( i < result.length ){
                    if(result[i].username || result[i].first_name || result[i].last_name){
                        s += (i+1) + ") ";
                        if (result[i].username)
                            s += result[i].username;
                        else
                            s += result[i].first_name + " " + result[i].last_name;

                        s += " " + result [i].karma + "\n";
                    }
                    ranking(i+1);
                }
            }
            ranking(0);
            ctx.reply(s, { reply_to_message_id : ctx.message.message_id });
        });
    } catch {
        console.log(err);
    }
});

nand.command("/qkarma", (ctx) => {

  var from = ctx.message.reply_to_message ? ctx.message.reply_to_message.from : ctx.from;

  updateUser(from.id, from.username, from.first_name, from.last_name);

  try {
    db.query("SELECT u.ID_User as ID, SUM(u.Vote) as karma FROM Upvotes u LEFT JOIN Messages m ON m.ID = u.ID_Message WHERE m.ID_User_From = ? GROUP BY u.ID_User;", [from.id] ,(err, result) => { 
        if(err)
            throw err;
        var karma = result.reduce((prev, curr) => prev + Math.sign(curr.karma) * Math.sqrt(Math.abs(curr.karma)), 0);
        // karma ^ 2 mantaining the sign
        var karma = Math.round( Math.sign(karma) * (karma**2) );
        if ( ctx.message.reply_to_message ){
            var s = ctx.message.reply_to_message.from.username ? "@" + ctx.message.reply_to_message.from.username : ctx.message.reply_to_message.from.first_name ;
            ctx.reply(s + " Quadratic Karma : " + karma, { reply_to_message_id : ctx.message.message_id } );
        } else
            ctx.replyWithMarkdown("*Quadratic Karma* : " + karma, { reply_to_message_id : ctx.message.message_id } );
        console.log("[KARMA] Hey @" + ctx.from.username + " Quadratic Karma : " + karma);
    });
  } catch {
    console.log(err);
  }
});

nand.command("/karma", (ctx) => {

  var from = ctx.message.reply_to_message ? ctx.message.reply_to_message.from : ctx.from;

  updateUser(from.id, from.username, from.first_name, from.last_name);

  try {
    db.query("SELECT m.ID_User_From as ID, SUM(u.Vote) as karma FROM Upvotes u LEFT JOIN Messages m ON m.ID = u.ID_Message WHERE m.ID_User_From = ?;", [from.id] ,(err, result) => { 
        if(err)
            throw err;
        if ( ctx.message.reply_to_message ){
            var s = ctx.message.reply_to_message.from.username ? "@" + ctx.message.reply_to_message.from.username : ctx.message.reply_to_message.from.first_name ;
            ctx.reply(s + " Karma: " + result[0].karma, { reply_to_message_id : ctx.message.message_id } );
        } else
            ctx.replyWithMarkdown("*Karma* : " + result[0].karma, { reply_to_message_id : ctx.message.message_id } );
        console.log("[KARMA] Hey @" + ctx.from.username + " Karma : " + result[0].karma);
    });
  } catch {
    console.log(err);
  }
});

nand.on("text", (ctx) => {

  console.log("[TEXT] " + ctx.from.id + " " + ctx.from.username + " " + ctx.from.first_name  + " " + ctx.from.last_name);
  updateUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);

  isBanned(ctx.from.id, (b) => {
      if(!b){
       
          var updown = new RegExp(/^(\+|\-)1$/);
        
          // # Karma Manger - Up and Down votes
          // Can't upvote another upvote
          if (ctx.message.reply_to_message && !updown.test(ctx.message.reply_to_message.text) && ctx.message.reply_to_message.from.id != ctx.from.id){
            if ( ctx.message.text == '+1' )
              vote(ctx.from.id, ctx.message.reply_to_message.message_id, ctx.message.reply_to_message.from.id, ctx.message.date, 1);
            else if ( ctx.message.text == '-1' )
              vote(ctx.from.id, ctx.message.reply_to_message.message_id, ctx.message.reply_to_message.from.id, ctx.message.date, -1);
          }
      } else {
          console.log(ctx.message);
          ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
      }
    });

});


// _ Setup database connection
var db = mysql.createConnection({
  host: conf.DB.host,
  user: conf.DB.user,
  password: conf.DB.password,
  database: conf.DB.database
});

db.connect(function(err) {
  
  if (err) throw err;

  console.log("[MYSQL] Connected!");

  nand.launch();

});
