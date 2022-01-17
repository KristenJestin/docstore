﻿using AutoMapper;
using Docstore.App.Common.Extensions;
using Docstore.App.Models;
using Docstore.App.Models.Forms;
using Docstore.Application.Common;
using Docstore.Application.Models;
using Docstore.Domain.Entities;
using Docstore.Domain.Extensions;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Docstore.App.Controllers
{
    public class DocumentsController : Controller
    {
        private readonly IMapper _mapper;
        private readonly AppDbContext _db;
        private readonly IWebHostEnvironment _hostingEnvironment;
        private readonly AppSettings _appSettings;

        public DocumentsController(AppDbContext db, IMapper mapper, IWebHostEnvironment hostingEnvironment, IOptions<AppSettings> appSettings)
        {
            _db = db;
            _mapper = mapper;
            _hostingEnvironment = hostingEnvironment;
            _appSettings = appSettings.Value;
        }


        #region actions
        public async Task<IActionResult> Index(int? folderId = null, int? tagId = null)
        {
            // get data
            IQueryable<Document> query = _db.Documents
                .OrderBy(d => d.Name)
                .Include(d => d.Tags);

            if (tagId != null && tagId > 0)
                query = query.Where(d => d.Tags.Any(x => x.Id == tagId));

            if (folderId != null && folderId > 0)
                query = query.Where(d => d.FolderId == folderId);

            var documents = await query
                // TODO: save in database size and count when inserting and updating files
                .Select(d => d.WithFilesCount(d.Files.Count).WithSize(d.Files.Sum(file => file.Size)))
                .ToListAsync();

            // response
            var viewModel = new DocumentsIndexViewModel
            {
                Documents = documents,
                FolderId = folderId
            };
            return View(viewModel);
        }

        public IActionResult Create(int? folderId = null)
        {
            // response
            var viewModel = new DocumentCreateViewModel(folderId);
            return View(viewModel);
        }

        [HttpPost]
        public async Task<IActionResult> Create(DocumentCreateForm? form)
        {
            // model validation
            try
            {
                if (ModelState.IsValid && form != null)
                {
                    // transform to database entity
                    var document = _mapper.Map<Document>(form);
                    document.Files = await form.UploadAndEncryptAndGetFilesAsync(_hostingEnvironment, _appSettings.AppKey!);
                    document.Tags = await form.CreateNewTagsAndGetListAsync(_db);

                    // save in database
                    await _db.AddAsync(document);
                    await _db.SaveChangesAsync();

                    // response
                    return RedirectToAction(nameof(Index));
                }
            }
            catch// (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // response
            var viewModel = new DocumentCreateViewModel
            {
                Form = form ?? DocumentCreateViewModel.GetDefaultFormValues()
            };
            return View(viewModel);
        }


        public async Task<IActionResult> Show(int id)
        {
            var document = await _db.Documents
                .Include(x => x.Files)
                .Include(x => x.Tags)
                .Include(x => x.Folder)
                .FirstOrDefaultAsync(x => x.Id == id);

            if (document == null)
                return NotFound();

            // response
            var viewModel = new DocumentShowViewModel(document);
            return View(viewModel);
        }

        [HttpGet("{controller}/" + nameof(Show) + "/{id:int}/{action}/{fileId:int}")]
        public async Task<IActionResult> Download(int id, int fileId)
        {
            var document = await _db.Documents
                .FindAsync(id);

            if (document == null)
                return NotFound();

            var file = await _db.DocumentFiles
                .FindAsync(fileId);

            if (file == null || document.Id != file.DocumentId)
                return NotFound();

            // response
            var filePath = file.GetFilePath(_hostingEnvironment.WebRootPath);
            return File(await Encryption.DecryptWithMemoryAsync(filePath, _appSettings.AppKey!), file.MimeType!, file.GetFileName(), true);
        }
        #endregion
    }
}
