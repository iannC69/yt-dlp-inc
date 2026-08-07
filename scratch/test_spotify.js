import spotifyUrlInfo from 'spotify-url-info'
import fetch from 'node-fetch'

const spotify = spotifyUrlInfo(fetch)

async function run() {
    try {
        const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' // Hot Hits USA (or something)
        const data = await spotify.getTracks(url)
        console.log('Tracks:', data.length)
        if (data.length > 0) {
            console.log('First track:', data[0])
        }
        
        const preview = await spotify.getPreview(url)
        console.log('Preview:', preview)
    } catch(e) {
        console.error(e)
    }
}
run()
