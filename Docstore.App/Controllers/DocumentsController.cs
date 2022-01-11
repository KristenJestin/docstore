using AutoMapper;
using Docstore.App.Common;
using Docstore.App.Common.Extensions;
using Docstore.Domain.Entities;
using Docstore.App.Models;
using Docstore.App.Models.Forms;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Docstore.Persistence.Contexts;

namespace Docstore.App.Controllers
{
    public class DocumentsController : Controller
    {
        private readonly IMapper _mapper;
        private readonly AppDbContext _db;
        private readonly IWebHostEnvironment _hostingEnvironment;

        public DocumentsController(AppDbContext db, IMapper mapper, IWebHostEnvironment hostingEnvironment)
        {
            _db = db;
            _mapper = mapper;
            _hostingEnvironment = hostingEnvironment;
        }


        #region actions
        public async Task<IActionResult> Index()
        {
            // get data
            var documents = await _db.Documents
                .OrderByDescending(d => d.CreatedAt)
                .ToListAsync();

            // response
            var viewModel = new DocumentsIndexViewModel
            {
                Documents = documents
            };
            return View(viewModel);
        }

        public IActionResult Create()
        {
            // response
            var viewModel = new DocumentCreateViewModel();
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
                    document.Files = await form.UploadAndGetFilesAsync(_hostingEnvironment);
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
                Form = form ?? DocumentCreateViewModel.DefaultFormValues
            };
            return View(viewModel);
        }


        public async Task<IActionResult> Show(int id)
        {
            var document = await _db.Documents
                .Include(x => x.Files)
                .Include(x => x.Tags)
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
            var fileBytes = await System.IO.File.ReadAllBytesAsync(file.GetFilePath(_hostingEnvironment));
            return File(fileBytes, file.MimeType!, file.GetFileName());
        }
        #endregion
    }
}
