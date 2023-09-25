# ![Banner](./docs/images/banner.png)

[![MIT License](https://img.shields.io/github/license/KristenJestin/docstore.svg?style=for-the-badge)](https://github.com/KristenJestin/docstore/blob/master/LICENSE)

## About Docstore

Application allowing to store files in a secure way via encryption.

Article on the development part of the project (FR) : [Docstore](https://kristenjestin.fr/articles/docstore)

## Tech Stack

**Server** : [ASP Core - C#6](https://docs.microsoft.com/fr-fr/aspnet/core/introduction-to-aspnet-core?view=aspnetcore-6.0), [Postgresql](https://www.postgresql.org/)

**Client** : [AlpineJs](https://alpinejs.dev/), [Unpoly](https://unpoly.com/), [Tailwind](https://tailwindcss.com/)

## Features

- Creating documents with several files
- Encryption of all files with AES
- Tagging
- Creating folders that contain multiple documents

## ScreenShots

| Home Page                                 |
| ----------------------------------------- |
| ![Home page](./docs/images/page-home.png) |

| Create Document Page                                             |
| ---------------------------------------------------------------- |
| ![Create Document page](./docs/images/page-documents-create.png) |

| Document Details Page                                              |
| ------------------------------------------------------------------ |
| ![Document details page](./docs/images/page-documents-details.png) |

## Run Locally

### Docker

Clone the project

```bash
  git clone https://github.com/KristenJestin/docstore
```

Start with docker compose

```bash
docker-compose up
```

## Roadmap

- Add page to create, edit and delete tags
- Add complete text when typing tags
- Add search bar to find documents or folders
- Display alert or notify when 'End date' of a document will expire soon

## License

Distributed under the MIT License. See [`LICENSE`](https://github.com/KristenJestin/docstore/blob/master/LICENSE) for more information.

<hr>

<div align="center">

[@KristenJestin](https://www.github.com/KristenJestin)

</div>

<div align="center">

[![portfolio](https://img.shields.io/badge/my_portfolio-ff8226?style=for-the-badge&logo=ko-fi&logoColor=white)](https://kristenjestin.fr)
[![linkedin](https://img.shields.io/badge/linkedin-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/kristen-jestin)

</div>
