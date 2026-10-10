# Highlands Garage Sales Tracker

A map of upcoming garage and yard sales in Highlands County, Florida.

- Pins are colored by timing: **green** today, **orange** this weekend, **blue** later.
- Search by address, city, zip or item (for example `estate` or `tools`), and filter by date.
- Satellite (with street names) or street map, your own location, and one-tap navigation in your phone's map app.
- Works on phones: the map comes first and the list is a drag-up panel.

The listings come from the public [Highlands County Tax Collector garage sale listing](https://www.hctaxcollector.com/garagesales/).

## How it works

| Piece | What it does |
| --- | --- |
| `scrape.mjs` | Reads the listing, looks up coordinates for each address (US Census geocoder, with an OpenStreetMap fallback), and writes `data.js`. Needs Node 18+ and no packages. |
| `GarageSalesTracker.html` | The whole map page: one static file that loads `data.js`. |
| `deploy/` | Scripts for a Linux server: pull from GitHub, publish the page, refresh the data daily. |

The page and the data are separate on purpose. Updating the page never touches `data.js`, and refreshing the data never touches the page.

## Run it locally

```sh
node scrape.mjs          # writes ATSPlugins/data.js
cp GarageSalesTracker.html ATSPlugins/
php -S localhost:8000 -t ATSPlugins   # or any static file server
```

Then open <http://localhost:8000/GarageSalesTracker.html>. Location features need HTTPS or `localhost`.

Scraper settings (environment variables, all optional):

- `OUT_DIR`: where `data.js` and `sales.json` are written (default: `ATSPlugins/` next to the script).
- `STATE_DIR`: where the geocode cache lives (default: next to the script).
- `WPNONCE`: a security token to use instead of finding one automatically. Only needed if the site changes how it provides it.

## Deploy on a Linux server (Apache or any static web server)

The setup below keeps a git checkout outside the web folder, copies only the page into the web folder, and writes the data there.

```sh
sudo apt install -y git nodejs

# 1. the checkout (outside the web root) and the two folders it needs
sudo git clone https://github.com/YOUR-USER/YOUR-REPO.git /opt/garage-sales
sudo install -d -o www-data -g www-data /var/www/garagesales /var/lib/garage-sales

# 2. install the two scripts as root-owned copies
sudo install -m 755 /opt/garage-sales/deploy/garage-sales-deploy.sh /usr/local/bin/garage-sales-deploy
sudo install -m 755 /opt/garage-sales/deploy/garage-sales-scrape.sh  /etc/cron.daily/garage-sales-update

# 3. publish the page now, and fetch data once
sudo /usr/local/bin/garage-sales-deploy
sudo /etc/cron.daily/garage-sales-update && cat /var/log/garage-scrape.log
```

Then add the pull job, which checks GitHub every 10 minutes and only does anything when there is a new commit:

```sh
echo '*/10 * * * * root /usr/bin/flock -n /run/garage-sales-deploy.lock /usr/local/bin/garage-sales-deploy >> /var/log/garage-sales-deploy.log 2>&1' \
  | sudo tee /etc/cron.d/garage-sales-deploy
```

Point your web server at `/var/www/garagesales`. For Apache, a dedicated virtual host keeps the tracker separate from anything else the server hosts (`/etc/apache2/sites-available/garagesales.conf`, then `sudo a2enmod headers && sudo a2ensite garagesales && sudo systemctl reload apache2`):

```apache
<VirtualHost *:80>
    ServerName garagesales.example.com
    DocumentRoot /var/www/garagesales
    DirectoryIndex GarageSalesTracker.html

    <Directory /var/www/garagesales>
        Options -Indexes
        AllowOverride None
        Require all granted
    </Directory>

    # data.js is rewritten daily, so make browsers re-fetch it
    <Files "data.js">
        Header set Cache-Control "no-cache"
    </Files>
</VirtualHost>
```

Location features only work over HTTPS, so put the site behind a TLS-terminating reverse proxy or add a certificate.

### Why it is set up this way

- **Polling, not webhooks.** The server only makes outbound requests to GitHub, so nothing needs to be exposed to the internet.
- **Root never runs repo code.** The deploy script is a root-owned copy installed once. The checkout is only ever read and copied from. The scraper, which does come from the checkout, runs as the unprivileged web user.
- **Updating the scripts in `deploy/`.** They are not applied automatically. After changing one, re-run its `install` command above.
- **Private repository?** Add a read-only [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) and clone with the SSH address.

## Setting your own details

Near the top of the script in `GarageSalesTracker.html`, set `REPO_URL` to this repository's address to show the "Source on GitHub" link in the footer. To change the name in the copyright line, edit the `<footer class="legal">` block, the comment at the top of the file, and the `LICENSE` file.

## License

[MIT](LICENSE). Copyright (c) 2026 Zen.

The license covers this project's code. The listing data belongs to its source, the Highlands County Tax Collector, and map data and imagery are credited on the map.
