import {
  useState,
} from 'react'


const ARTICLES = [
  {
    title:
      'NASA MARS FACTS',

    url:
      'https://science.nasa.gov/mars/facts/',
  },

  {
    title:
      'NASA MARS',

    url:
      'https://science.nasa.gov/mars/',
  },

  {
    title:
      'NASA SEARCH · MARS',

    url:
      'https://www.nasa.gov/search/?q=Mars',
  },
]


export default function MarsBriefingPanel() {
  const [
    selected,
    setSelected,
  ] = useState(0)

  const [
    frameKey,
    setFrameKey,
  ] = useState(0)

  const article =
    ARTICLES[selected]


  function openArticle() {
    window.open(
      article.url,
      '_blank',
      'noopener,noreferrer',
    )
  }


  return (
    <div className="briefing-body">
      <div className="briefing-tabs">
        {ARTICLES.map(
          (
            item,
            index,
          ) => (
            <button
              key={item.url}
              type="button"
              className={
                selected ===
                index
                  ? 'briefing-tab active'
                  : 'briefing-tab'
              }
              onClick={() =>
                setSelected(
                  index,
                )
              }
            >
              {
                item.title
              }
            </button>
          ),
        )}
      </div>


      <div className="briefing-actions">
        <button
          type="button"
          onClick={() =>
            setFrameKey(
              (value) =>
                value + 1,
            )
          }
        >
          REFRESH
        </button>

        <button
          type="button"
          onClick={
            openArticle
          }
        >
          OPEN NEW TAB ↗
        </button>
      </div>


      <div className="briefing-frame-wrap">
        <iframe
          key={`${article.url}:${frameKey}`}
          title={
            article.title
          }
          src={
            article.url
          }
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>


      <p className="briefing-note">
        Some NASA pages may block embedding with browser security headers.
        OPEN NEW TAB remains the reliable fallback.
      </p>
    </div>
  )
}
