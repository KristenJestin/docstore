using AutoMapper;
using Docstore.App.Common.Extensions;
using Docstore.App.Models;
using Docstore.App.Models.Forms;
using Docstore.Application.Common;
using Docstore.Application.Interfaces;
using Docstore.Application.Models;
using Docstore.Application.Models.DTO;
using Docstore.Domain.Entities;
using Docstore.Domain.Extensions;
using Docstore.Persistence.Contexts;
using Docstore.Persistence.Repositories;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Collections.Generic;

namespace Docstore.App.Controllers
{
    public class DocumentsController : Controller
    {
        private const int PAGE_SIZE = 6;

        private readonly IMapper _mapper;
        private readonly AppDbContext _db;
        private readonly IWebHostEnvironment _hostingEnvironment;
        private readonly AppSettings _appSettings;
        private readonly IDocumentRepository _documentRepository;
        private readonly IFolderRepository _folderRepository;
        private readonly IDocumentFileRepository _documentFileRepository;

        public DocumentsController(AppDbContext db, IMapper mapper, IWebHostEnvironment hostingEnvironment, IOptions<AppSettings> appSettings, IDocumentRepository documentRepository, IFolderRepository folderRepository, IDocumentFileRepository documentFileRepository)
        {
            _db = db;
            _mapper = mapper;
            _hostingEnvironment = hostingEnvironment;
            _appSettings = appSettings.Value;
            _documentRepository = documentRepository;
            _folderRepository = folderRepository;
            _documentFileRepository = documentFileRepository;
        }


        #region actions
        public async Task<IActionResult> Index(int? page = 1, int? folderId = null, int? tagId = null)
        {
            // get data
            var documents = await _documentRepository.GetPagedReponseAsync(page ?? 1, PAGE_SIZE, tag: tagId, folder: folderId);

            Folder? folder = null;
            if (folderId != null)
                folder = await _db.Folders.FindAsync(folderId.Value);

            // response
            var viewModel = new DocumentsIndexViewModel
            {
                Documents = documents,
                FolderId = folderId,
                Folder = folder
            };
            return View(viewModel);
        }

        public async Task<IActionResult> Create(int? folderId = null)
        {
            // data
            Folder? folder = null;

            if (folderId != null)
                folder = await _folderRepository.FindByIdAsync(folderId.Value);

            // response
            var viewModel = new DocumentCreateViewModel(folderId, folder);
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
                    document.Tags = await form.CreateNewTagsAndGetListAsync(_db);

                    // save in database
                    await _db.AddAsync(document);
                    await _db.SaveChangesAsync();

                    // response
                    return RedirectToAction(nameof(Index));
                }
            }
            catch (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // pick folder if it selected
            Folder? folder = null;
            if (form?.FolderId != null)
                folder = await _folderRepository.FindByIdAsync(form.FolderId.Value);

            IEnumerable<GetDocumentFileDto> files = new List<GetDocumentFileDto>();
            if (form?.Files != null && form.Files.Any())
            {
                var documentFiles = await _documentFileRepository.FindByIdsAsync(form.Files.ToArray());
                files = _mapper.Map<IEnumerable<GetDocumentFileDto>>(documentFiles);
            }

            // response
            var viewModel = new DocumentCreateViewModel(folder?.Id, folder, files)
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
