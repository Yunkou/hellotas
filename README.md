# Tasmania Welcome Platform (hellotas)

A student-built guide to events, stories and community life for ICT students in Tasmania.

**Live site:** https://weiluoyan.github.io/hellotas/events/

---

## Why this exists

When I arrived in Tasmania as a new international student, finding out what was happening was harder than it should have been. Events were shared in many different places, MyLO was full of notices, and it was easy to miss things, or to find out about them after they had finished. Teachers had to post the same reminders again and again.

This project puts it all in one place, so that:

- **New students** can see what ICT students before them did, and how they found their place and their first job in Tasmania.
- **Teachers** can share one link instead of posting reminders again.
- **UTAS colleagues overseas** can follow what is happening in Tasmania.

## What's here now

- **ICT Events page** for 2025 and 2026, with photos and details for each event.

This is an early version. Some events are examples, and the full list is still being checked, so details may change.

## Coming next

- Upcoming events page
- Student stories: how people found their first job and settled in
- Local community volunteering and career-relevant volunteering
- Local sports and wellbeing activities
- More languages

## Built with

- [Hugo](https://gohugo.io/) static site generator
- [PaperMod](https://github.com/adityatelange/hugo-PaperMod) theme
- GitHub Pages, deployed with GitHub Actions

## Run it locally

1. [Install Hugo](https://gohugo.io/installation/) (extended version).
2. Clone the repository:
   ```
   git clone https://github.com/weiluoyan/hellotas.git
   cd hellotas
   ```
3. Start the local server:
   ```
   hugo server
   ```
4. Open the address Hugo prints in your terminal, usually http://localhost:1313/.

## Adding or changing an event

Event pages live in the `content/` folder. To add one, create a new Markdown file there, using an existing event as your template, and add its photos to `static/`. When you push to `main`, the site is rebuilt and deployed automatically.

## Photos and content

Event photos and details belong to the people and organisations who took part in them. If you appear in a photo or are named on the site and would like it changed or removed, please open an issue or contact me and I'll sort it out.

## About

Built by Luoyan Wei (Laura), UTAS Master of Information Technology and Systems graduate (2026), as a volunteer project to help new students feel at home in Tasmania.

Suggestions and event tips are welcome. Please open an issue.
